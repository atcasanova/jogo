import numpy as np
import subprocess
import json
import os
import time
import fcntl
import select
from typing import List, Tuple, Dict, Any

from json_logger import info, error, warning

class GameEnvironment:
    def __init__(self):
        self.node_process = None
        self.game_state = None
        self.action_space_size = 50
        self.state_size = 200
        
    def start_node_game(self):
        """Start the Node.js game process"""
        try:
            # Kill any existing processes
            subprocess.run(['pkill', '-f', 'game_wrapper.js'], 
                          capture_output=True, check=False)
            time.sleep(1)
            
            info("Starting Node.js game process")
            
            # Start process with unbuffered I/O
            self.node_process = subprocess.Popen(
                ['node', 'game_wrapper.js'],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd='game',
                bufsize=0  # Unbuffered
            )
            
            # Make stdout non-blocking
            fd = self.node_process.stdout.fileno()
            fl = fcntl.fcntl(fd, fcntl.F_GETFL)
            fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)
            
            # Wait for ready signal
            ready = False
            info("Waiting for ready signal")
            
            for attempt in range(50):  # 25 seconds total
                try:
                    # Use select to check for available data
                    ready_fds, _, _ = select.select([self.node_process.stdout], [], [], 0.5)
                    
                    if ready_fds:
                        line = self.node_process.stdout.readline()
                        if line:
                            line = line.strip()
                            info("Received line", snippet=line[:50])  # First 50 chars
                            
                            if line.startswith('{'):
                                try:
                                    response = json.loads(line)
                                    if response.get('ready'):
                                        info("Ready signal received")
                                        ready = True
                                        break
                                except json.JSONDecodeError:
                                    continue
                except:
                    pass
                
                # Check if process died
                if self.node_process.poll() is not None:
                    error("Node.js process terminated")
                    return False
            
            if not ready:
                error("No ready signal received")
                return False

            info("Node.js game process started successfully")
            return True
                
        except Exception as e:
            error("Error starting Node.js game", exception=str(e))
            return False
    
    def send_command(self, command: Dict) -> Dict:
        """Send command to Node.js game and get response"""
        if not self.node_process:
            return {"error": "Game process not started"}
        
        try:
            # Send command
            command_str = json.dumps(command)
            self.node_process.stdin.write(command_str + '\n')
            self.node_process.stdin.flush()
            
            # Read response with timeout
            for attempt in range(20):  # 10 seconds total
                try:
                    ready_fds, _, _ = select.select([self.node_process.stdout], [], [], 0.5)
                    
                    if ready_fds:
                        line = self.node_process.stdout.readline()
                        if line:
                            line = line.strip()
                            
                            # Only process JSON lines
                            if line.startswith('{'):
                                try:
                                    return json.loads(line)
                                except json.JSONDecodeError:
                                    continue
                            # Skip non-JSON debug output
                except:
                    continue
            
            return {"error": "Timeout waiting for response"}
                
        except Exception as e:
            return {"error": f"Communication error: {e}"}
    
    def reset(self) -> np.ndarray:
        """Reset game and return initial state"""
        if not self.node_process or self.node_process.poll() is not None:
            if not self.start_node_game():
                return np.zeros(self.state_size)
        
        response = self.send_command({"action": "reset"})
        if response.get('success'):
            self.game_state = response.get("gameState", {})
            # Ensure win information fields exist for trainer
            self.game_state['gameEnded'] = False
            self.game_state['winningTeam'] = response.get('winningTeam')
            info("Game reset successful")
            board = response.get('board')
            if board is not None:
                info("Board state after reset", board=board)
        else:
            error("Game reset failed", response=response)
        
        return self.get_state(0)
    
    def get_state(self, player_id: int) -> np.ndarray:
        """Convert game state to neural network input"""
        state = np.zeros(self.state_size)
        
        if not self.game_state:
            return state
        
        try:
            # Encode current player
            current_player = self.game_state.get('currentPlayerIndex', 0)
            state[0] = current_player / 4.0
            state[1] = player_id / 4.0
            
            # Encode player's cards
            players = self.game_state.get('players', [])
            if player_id < len(players):
                player = players[player_id]
                cards = player.get('cards', [])
                
                card_values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K']
                
                for i, card in enumerate(cards[:5]):
                    if 'value' in card and i < 5:
                        try:
                            card_idx = card_values.index(card['value'])
                            base_idx = 10 + i * len(card_values)
                            if base_idx + card_idx < self.state_size:
                                state[base_idx + card_idx] = 1
                        except (ValueError, IndexError):
                            pass
            
            # Encode pieces
            pieces = self.game_state.get('pieces', [])
            pieces_start = 80
            
            for piece in pieces:
                if piece.get('playerId') == player_id:
                    piece_id = piece.get('pieceId', 1)
                    if 1 <= piece_id <= 5:
                        piece_idx = pieces_start + (piece_id - 1) * 4
                        
                        if piece_idx + 3 < self.state_size:
                            if piece.get('inPenaltyZone'):
                                state[piece_idx] = 1
                            elif piece.get('inHomeStretch'):
                                state[piece_idx + 1] = 1
                            elif piece.get('completed'):
                                state[piece_idx + 2] = 1
                            else:
                                state[piece_idx + 3] = 1
            
        except Exception as e:
            warning("Error encoding state", exception=str(e))
        
        return state
    
    def get_valid_actions(self, player_id: int) -> List[int]:
        """Get valid actions for current player"""
        response = self.send_command({
            "action": "getValidActions",
            "playerId": player_id
        })
        
        actions = response.get("validActions", [0])
        return actions[:10] if len(actions) > 10 else actions  # Limit actions
    
    def step(self, action: int, player_id: int) -> Tuple[np.ndarray, float, bool]:
        """Execute action and return next_state, reward, done"""
        response = self.send_command({
            "action": "makeMove",
            "playerId": player_id,
            "actionId": action
        })
        
        # Calculate reward
        reward = 0.1 if response.get('success') else -0.1
        done = response.get('gameEnded', False)

        if response.get('success'):
            self.game_state = response.get("gameState", self.game_state)
            # Preserve win information returned by the Node process
            self.game_state['gameEnded'] = done
            self.game_state['winningTeam'] = response.get('winningTeam')
        
        next_state = self.get_state(player_id)
        return next_state, reward, done
    
    def close(self):
        """Close the game process"""
        if self.node_process:
            try:
                self.node_process.terminate()
                self.node_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.node_process.kill()
            finally:
                self.node_process = None


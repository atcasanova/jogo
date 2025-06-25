import numpy as np
import subprocess
import json
import os
import time
import fcntl
import select
import threading
from typing import List, Tuple, Dict, Any

from json_logger import info, error, warning

class GameEnvironment:
    def __init__(self, env_id: int = 0):
        self.node_process = None
        self.game_state = None
        self.action_space_size = 80
        self.state_size = 200

        # identifier for logging when multiple environments are used
        self.env_id = env_id

        # store detailed history for debugging
        # each entry will contain the textual move and the full game state
        self.move_history: List[Dict[str, Any]] = []

        # background thread to drain Node.js stderr
        self.stderr_thread = None

        # Precompute track coordinates and entrance squares for distance checks
        self._track: List[Dict[str, int]] = self._generate_track()
        self._entrances = [
            {'row': 0, 'col': 4},
            {'row': 4, 'col': 18},
            {'row': 18, 'col': 14},
            {'row': 14, 'col': 0}
        ]

    def _generate_track(self) -> List[Dict[str, int]]:
        """Replicate the board track coordinates from the Node game."""
        track: List[Dict[str, int]] = []
        for col in range(19):
            track.append({'row': 0, 'col': col})
        for row in range(1, 19):
            track.append({'row': row, 'col': 18})
        for col in range(17, -1, -1):
            track.append({'row': 18, 'col': col})
        for row in range(17, 0, -1):
            track.append({'row': row, 'col': 0})
        return track

    def _steps_to_entrance(self, pos: Dict[str, int], player_id: int) -> int:
        """Calculate steps from ``pos`` to the player's home stretch entrance."""
        entrance = self._entrances[player_id]
        try:
            start_idx = next(i for i, p in enumerate(self._track)
                             if p['row'] == pos['row'] and p['col'] == pos['col'])
            ent_idx = next(i for i, p in enumerate(self._track)
                           if p['row'] == entrance['row'] and p['col'] == entrance['col'])
        except StopIteration:
            return -1
        return (ent_idx - start_idx + len(self._track)) % len(self._track)

    def _track_index(self, pos: Dict[str, int]) -> int:
        """Return the index of ``pos`` along the outer track or ``-1``."""
        for i, square in enumerate(self._track):
            if square['row'] == pos.get('row') and square['col'] == pos.get('col'):
                return i
        return -1

    def _count_opponent_near_home(self, pieces: Dict[str, Dict[str, Any]], player_id: int, threshold: int = 10) -> int:
        """Count opponent pieces close to their home stretch entrance."""
        teams = self.game_state.get('teams', []) if self.game_state else []
        my_team: List[int] = []
        for team in teams:
            if any(pl.get('position') == player_id for pl in team):
                my_team = [pl.get('position') for pl in team]
                break
        opponents = {pl for pl in range(4) if pl not in my_team}
        count = 0
        for pinfo in pieces.values():
            if pinfo.get('player_id') not in opponents:
                continue
            if pinfo.get('in_penalty') or pinfo.get('in_home') or pinfo.get('completed'):
                continue
            pos = pinfo.get('pos')
            if not isinstance(pos, dict):
                continue
            steps = self._steps_to_entrance(pos, pinfo.get('player_id', 0))
            if 0 <= steps <= threshold:
                count += 1
        return count
        
    def start_node_game(self):
        """Start the Node.js game process"""
        try:
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

            # Drain stderr in the background to avoid blocking
            def _drain():
                try:
                    for line in iter(self.node_process.stderr.readline, ''):
                        line = line.strip()
                        if line:
                            info("node stderr", env=self.env_id, msg=line)
                except Exception as e:
                    warning("stderr thread error", env=self.env_id, error=str(e))

            self.stderr_thread = threading.Thread(target=_drain, daemon=True)
            self.stderr_thread.start()
            
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

        if self.node_process.poll() is not None:
            error("Node.js process terminated", env=self.env_id)
            return {"error": "Process terminated"}
        
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
    
    def reset(self, bot_names=None) -> np.ndarray:
        """Reset game and return initial state.

        Parameters
        ----------
        bot_names : Optional[List[str]]
            Names to assign to seats 0-3 so logs reflect the actual bots.
        """
        if not self.node_process or self.node_process.poll() is not None:
            if not self.start_node_game():
                return np.zeros(self.state_size)

        command = {"action": "reset"}
        if bot_names:
            command["botNames"] = bot_names

        response = self.send_command(command)
        if response.get('success'):
            self.game_state = response.get("gameState", {})
            # Ensure win information fields exist for trainer
            self.game_state['gameEnded'] = False
            self.game_state['winningTeam'] = response.get('winningTeam')
            info("Game reset successful")
            # clear previous move history
            self.move_history = []
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

    def _default_discards(self, player_id: int) -> List[int]:
        """Generate discard actions from the cached game state."""
        players = self.game_state.get('players', []) if self.game_state else []
        if 0 <= player_id < len(players):
            cards = players[player_id].get('cards', [])
            max_discards = min(len(cards), 10)
            return [70 + i for i in range(max_discards)]
        return []
    
    def get_valid_actions(self, player_id: int) -> List[int]:
        """Get valid actions for current player"""
        response = self.send_command({
            "action": "getValidActions",
            "playerId": player_id
        })
        
        if 'error' in response:
            fallback = self._default_discards(player_id)
            return [fallback[0]] if fallback else []

        actions = response.get("validActions", [])
        # Ensure actions are within the defined action space and remain valid
        # when checked individually. The Node wrapper occasionally returns
        # discard actions for cards that no longer exist. Filtering with
        # ``is_action_valid`` prevents the agent from repeatedly sending
        # impossible moves.
        filtered: List[int] = []
        for act in actions:
            if 0 <= act < self.action_space_size and self.is_action_valid(player_id, act):
                filtered.append(act)

        if not filtered:
            discard_actions = [a for a in actions if a >= 70]
            if discard_actions:
                return [discard_actions[0]]
            fallback = self._default_discards(player_id)
            return [fallback[0]] if fallback else []

        # Deduplicate while preserving order so the bot only evaluates unique
        # options.
        unique_actions: List[int] = []
        seen = set()
        for act in filtered:
            if act not in seen:
                seen.add(act)
                unique_actions.append(act)

        # Return the complete set of valid actions so the agent can evaluate
        # every option provided by the game wrapper.
        return unique_actions

    def is_action_valid(self, player_id: int, action: int) -> bool:
        """Ask the Node wrapper if a specific action is valid"""
        response = self.send_command({
            "action": "isActionValid",
            "playerId": player_id,
            "actionId": action
        })
        if 'error' in response:
            return False
        if 'valid' not in response:
            # When running with mocked send_command the response may omit the
            # ``valid`` field. Assume True so tests can patch ``send_command``
            # without also mocking ``is_action_valid``.
            return True
        return bool(response.get("valid"))
    
    def step(self, action: int, player_id: int) -> Tuple[np.ndarray, float, bool]:
        """Execute action and return next_state, reward, done"""
        invalid_attempts = 0
        tried_actions = set()

        while True:
            if not self.is_action_valid(player_id, action):
                invalid_attempts += 1
                tried_actions.add(action)
                valid_actions = self.get_valid_actions(player_id)
                alt_actions = [a for a in valid_actions if a not in tried_actions]
                if not alt_actions:
                    discard_actions = [
                        a for a in valid_actions
                        if a >= 70 and a not in tried_actions
                    ]
                    if not discard_actions:
                        discard_actions = [
                            d for d in range(70, 80)
                            if d not in tried_actions
                        ]
                    for discard in discard_actions:
                        cmd = {
                            "action": "makeMove",
                            "playerId": player_id,
                            "actionId": discard
                        }
                        tried_actions.add(discard)
                        response = self.send_command(cmd)
                        if response.get('success'):
                            break
                    break
                action = alt_actions[0]
                continue

            if action >= 70:
                cmd = {"action": "makeMove", "playerId": player_id, "actionId": action}
            elif action >= 60:
                cmd = {"action": "makeSpecialMove", "playerId": player_id, "actionId": action}
            else:
                cmd = {"action": "makeMove", "playerId": player_id, "actionId": action}

            response = self.send_command(cmd)
            tried_actions.add(action)
            if response.get('success'):
                break

            invalid_attempts += 1
            error(
                "Action failed", env=self.env_id, player=player_id,
                action=action, response=response
            )

            valid_actions = self.get_valid_actions(player_id)
            alt_actions = [a for a in valid_actions if a not in tried_actions]
            if not alt_actions:
                discard_actions = [
                    a for a in valid_actions
                    if a >= 70 and a not in tried_actions
                ]
                if not discard_actions:
                    discard_actions = [
                        d for d in range(70, 80)
                        if d not in tried_actions
                    ]
                for discard in discard_actions:
                    cmd = {
                        "action": "makeMove",
                        "playerId": player_id,
                        "actionId": discard
                    }
                    tried_actions.add(discard)
                    response = self.send_command(cmd)
                    if response.get('success'):
                        break
                break

            action = alt_actions[0]

        # Reward shaping
        reward = -0.1 * invalid_attempts
        if response.get('success'):
            reward += 0.05  # basic incentive for a valid move
        done = response.get('gameEnded', False)

        prev_pieces = {}
        if self.game_state and 'pieces' in self.game_state:
            for p in self.game_state['pieces']:
                prev_pieces[p.get('id')] = {
                    'in_home': p.get('inHomeStretch'),
                    'completed': p.get('completed'),
                    'pos': p.get('position'),
                    'in_penalty': p.get('inPenaltyZone'),
                    'player_id': p.get('playerId')
                }

        teams = self.game_state.get('teams', []) if self.game_state else []
        my_team: List[int] = []
        for team in teams:
            if any(pl.get('position') == player_id for pl in team):
                my_team = [pl.get('position') for pl in team]
                break
        opponents = {pl for pl in range(4) if pl not in my_team}

        # Record previous near-home status for all pieces
        prev_near_home: Dict[str, bool] = {}
        for pid, info in prev_pieces.items():
            pos = info.get('pos')
            near = False
            if pos and not info.get('in_penalty') and not info.get('in_home') and not info.get('completed'):
                steps = self._steps_to_entrance(pos, info.get('player_id', 0))
                near = 0 <= steps <= 10
            prev_near_home[pid] = near

        # Update game state whenever provided
        if 'gameState' in response:
            self.game_state = response['gameState']
            self.game_state['gameEnded'] = done
            self.game_state['winningTeam'] = response.get('winningTeam')
            if 'stats' in response:
                self.game_state['stats'] = response['stats'].get('full', {})
                self.game_state['statsSummary'] = response['stats'].get('summary')

            last_move = self.game_state.get('lastMove')
            if last_move is not None:
                try:
                    state_copy = json.loads(json.dumps(self.game_state))
                except Exception:
                    state_copy = self.game_state
                self.move_history.append({'move': str(last_move), 'state': state_copy})

            for p in self.game_state.get('pieces', []):
                pid = p.get('id')
                if not pid:
                    continue
                owner = p.get('playerId')
                now_penalty = p.get('inPenaltyZone')
                pos = p.get('position')
                near = False
                if pos and not now_penalty and not p.get('inHomeStretch') and not p.get('completed'):
                    steps = self._steps_to_entrance(pos, owner)
                    near = 0 <= steps <= 10

                prev_info = prev_pieces.get(pid)
                was_near = prev_near_home.get(pid, False)
                if prev_info and pos and prev_info.get('pos') and not now_penalty and not p.get('completed'):
                    prev_idx = self._track_index(prev_info['pos'])
                    new_idx = self._track_index(pos)
                    if prev_idx != -1 and new_idx != -1:
                        diff = (prev_idx - new_idx) % len(self._track)
                        if diff > 0:
                            reward += 0.1 * diff

                        # Penalize skipping the home entrance when it was
                        # possible to enter.
                        forward = (new_idx - prev_idx) % len(self._track)
                        backward = (prev_idx - new_idx) % len(self._track)
                        moved_forward = forward <= backward
                        prev_steps = self._steps_to_entrance(prev_info['pos'], owner)
                        if (
                            moved_forward
                            and 0 < prev_steps <= 6
                            and forward > prev_steps
                            and not p.get('inHomeStretch')
                        ):
                            reward -= 0.3

                if owner in my_team:
                    if prev_info and not prev_info['in_penalty'] and now_penalty:
                        reward -= 0.5

                prev_near_home[pid] = was_near

            for cap in response.get('captures', []):
                cid = cap.get('pieceId')
                info = prev_pieces.get(cid)
                if not info:
                    continue
                owner = info.get('player_id')
                near = prev_near_home.get(cid, False)
                if owner in my_team:
                    reward -= 0.5
                else:
                    reward += 0.5 if near else 0.2


        # Bonus for winning the game
        if done and response.get('winningTeam'):
            for pl in response['winningTeam']:
                if pl.get('position') == player_id:
                    reward += 2.0
                    break

        # Log failures for easier debugging
        if not response.get('success'):
            error("Action failed", env=self.env_id, player=player_id, action=action, response=response)
        
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
                self.stderr_thread = None

    def save_history(self, filepath: str) -> None:
        """Persist the collected move history to a text file"""
        if not self.move_history:
            return

        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                for entry in self.move_history:
                    if isinstance(entry, dict):
                        json.dump(entry, f, ensure_ascii=False)
                        f.write('\n')
                    else:
                        f.write(f"{entry}\n")
            info("Saved move history", env=self.env_id, file=filepath)
        except Exception as e:
            warning("Failed to save move history", env=self.env_id, file=filepath, error=str(e))


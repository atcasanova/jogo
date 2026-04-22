import numpy as np
import subprocess
import json
import os
import time
import fcntl
import select
import threading
from typing import List, Tuple, Dict, Any, Optional

from json_logger import info, error, warning
from config import (
    HEAVY_REWARD_BASE,
    REWARD_WEIGHTS,
    REWARD_CLIP_RANGE,
    STEP_PENALTY_BASE,
    LONG_GAME_PENALTY_START,
    LONG_GAME_PENALTY_INTERVAL,
    LONG_GAME_PENALTY_BASE,
    FAST_FINISH_BONUS_SCALE,
)

# Simplified reward system used for initial curriculum training
PIECE_COMPLETION_REWARD = 50.0
# Only penalty currently applied when a bot rejects a homestretch entry
SKIP_HOME_PENALTY = -1.0

# The following constants remain for compatibility but do not affect rewards
HOME_ENTRY_REWARD = 0.0
DIRECT_COMPLETE_REWARD = 0.0
HOME_COMPLETION_REWARD = PIECE_COMPLETION_REWARD
ENEMY_HOME_ENTRY_PENALTY = 0.0
INVALID_MOVE_PENALTY = 0.0
WIN_BONUS = REWARD_WEIGHTS.get('win', 20.0)
# Base timeout penalty; TrainingManager scales this by current piece count so
# unresolved high-difficulty games receive stronger negative feedback.
TIMEOUT_PENALTY = -4.0

# Deprecated reward configuration retained for backward compatibility
HOME_ENTRY_REWARDS = []
COMPLETION_BONUS = 0.0
COMPLETION_DELAY_BASE = 0.0
COMPLETION_DELAY_GROWTH = 1.0
COMPLETION_DELAY_CAP = 0.0
POSITIVE_REWARD_DECAY = 1.0
FINAL_MOVE_BONUS = 0.0
STAGNATION_PENALTY = 0.0
LATE_STAGNATION_PENALTY = 0.0


class GameEnvironment:
    def __init__(self, env_id: int = 0, pieces_per_player: int = 5, turn_limit: int = 500):
        self.node_process = None
        self.game_state = None
        self.action_space_size = 80
        # Richer observation vector with full-board context and tactical hints.
        self.state_size = 320

        self.pieces_per_player = pieces_per_player
        self.turn_limit = turn_limit

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

        # Starting squares when leaving the penalty zone
        self._starts = [
            {'row': 0, 'col': 8},
            {'row': 8, 'col': 18},
            {'row': 18, 'col': 10},
            {'row': 10, 'col': 0}
        ]

        # Coordinates for each player's home stretch positions
        self._home_stretches = [
            [
                {'row': 1, 'col': 4},
                {'row': 2, 'col': 4},
                {'row': 3, 'col': 4},
                {'row': 4, 'col': 4},
                {'row': 5, 'col': 4},
            ],
            [
                {'row': 4, 'col': 17},
                {'row': 4, 'col': 16},
                {'row': 4, 'col': 15},
                {'row': 4, 'col': 14},
                {'row': 4, 'col': 13},
            ],
            [
                {'row': 17, 'col': 14},
                {'row': 16, 'col': 14},
                {'row': 15, 'col': 14},
                {'row': 14, 'col': 14},
                {'row': 13, 'col': 14},
            ],
            [
                {'row': 14, 'col': 1},
                {'row': 14, 'col': 2},
                {'row': 14, 'col': 3},
                {'row': 14, 'col': 4},
                {'row': 14, 'col': 5},
            ],
        ]

        # Adjustable reward weight for important plays
        self.heavy_reward = HEAVY_REWARD_BASE
        # Configurable win bonus applied when a team wins
        self.win_bonus = WIN_BONUS
        # Reward scale no longer depends on piece count
        # Use a constant factor of ``1.0`` for all situations
        self.positive_reward_scale = 1.0

        # Track how often each reward type occurs for analysis
        self.reward_event_counts = {
            'home_completion': 0,
            'skip_home': 0,
            'home_entry_progress': 0,
            'capture': 0,
            'safe_move': 0,
            'long_game': 0,
            'win': 0,
            'loss': 0,
        }

        # Track the total reward contributed by each event type
        self.reward_event_totals = {
            'home_completion': 0.0,
            'skip_home': 0.0,
            'home_entry_progress': 0.0,
            'capture': 0.0,
            'safe_move': 0.0,
            'long_game': 0.0,
            'win': 0.0,
            'loss': 0.0,
        }
        # Bonus rewards retained for compatibility with the trainer
        self.reward_bonus_totals: Dict[str, float] = {
            'win_bonus': 0.0,
            'final_move_bonus': 0.0,
        }

        # Count how many times the heavy reward bonus was applied in a game
        self.heavy_reward_events = 0

        # Track heavy reward events by type for detailed analysis
        self.heavy_reward_breakdown = {
            'home_entry': 0,
            'penalty_exit': 0,
            'capture': 0,
            'special': 0,
        }

        # Map from player index to team index
        self.player_team_map: Dict[int, int] = {}
        # Pending penalties to apply on each player's next move
        self.pending_penalties = [0.0] * 4
        # Next global turn when no-home penalties should be checked
        self.next_penalty_check = 60
        # Turns since each team last completed a piece
        self.completion_delay_turns = [0, 0]
        # Rate at which the completion delay penalty grows for each team
        self.completion_delay_growth = [COMPLETION_DELAY_GROWTH] * 2
        # Track consecutive steps without progress for stagnation penalties
        # Each entry stores general stagnation count and count after two
        # pieces are completed with no further progress.
        self.no_progress_steps = [
            {'general': 0, 'since_two': 0} for _ in range(4)
        ]
        # Store info for the most recent step such as final bonuses
        self.last_step_info: Dict[str, float] = {}
        # Cache legal actions so state encoding can include action metadata.
        self.last_valid_actions: Dict[int, List[int]] = {}

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

    def _home_index(self, pos: Dict[str, int], player_id: int) -> int:
        """Return the index within the player's home stretch or ``-1``."""
        if not pos or not (0 <= player_id < len(self._home_stretches)):
            return -1
        for i, square in enumerate(self._home_stretches[player_id]):
            if square['row'] == pos.get('row') and square['col'] == pos.get('col'):
                return i
        return -1

    def _in_entry_zone(self, pos: Dict[str, int], player_id: int) -> bool:
        """Return ``True`` if ``pos`` lies within the player's entry zone."""
        steps = self._steps_to_entrance(pos, player_id)
        return 0 <= steps <= 10

    def _is_start_square(self, pos: Dict[str, int], player_id: int) -> bool:
        """Return ``True`` if ``pos`` is the starting square for ``player_id``."""
        start = self._starts[player_id]
        return (
            pos
            and pos.get('row') == start['row']
            and pos.get('col') == start['col']
        )

    def _count_opponent_near_home(self, pieces: Dict[str, Dict[str, Any]], player_id: int, threshold: int = 10) -> int:
        """Count opponent pieces close to their home stretch entrance."""
        teams = self.game_state.get('teams', []) if self.game_state else []
        my_team: List[int] = []
        for team in teams:
            if any(pl.get('position') == player_id for pl in team):
                my_team = [pl.get('position') for pl in team]
                break

        partner_id = None
        if len(my_team) == 2:
            partner_id = my_team[0] if my_team[1] == player_id else my_team[1]


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

        command = {"action": "reset", "pieces": self.pieces_per_player}
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
            self.reset_reward_events()
            teams = self.game_state.get('teams', [])
            self.player_team_map = {}
            for idx, team in enumerate(teams):
                for pl in team:
                    pos = pl.get('position')
                    if pos is not None:
                        self.player_team_map[int(pos)] = idx
            self.pending_penalties = [0.0] * 4
            self.next_penalty_check = 60
            self.completion_delay_turns = [0] * max(len(teams), 2)
        else:
            error("Game reset failed", response=response)
        
        return self.get_state(0)
    
    def get_state(self, player_id: int) -> np.ndarray:
        """Convert game state to a richer neural network input."""
        state = np.zeros(self.state_size)
        
        if not self.game_state:
            return state
        
        try:
            # Core turn metadata
            current_player = self.game_state.get('currentPlayerIndex', 0)
            state[0] = current_player / 4.0
            state[1] = player_id / 4.0
            state[2] = min(1.0, len(self.game_state.get('deck', [])) / 108.0)
            state[3] = min(1.0, len(self.game_state.get('discardPile', [])) / 108.0)
            state[4] = min(1.0, float(self.game_state.get('turnCount', 0)) / max(1, self.turn_limit))
            
            # Encode player's cards
            players = self.game_state.get('players', [])
            if player_id < len(players):
                player = players[player_id]
                cards = player.get('cards', [])
                
                card_values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'JOKER']
                
                for i, card in enumerate(cards[:5]):
                    if 'value' in card and i < 5:
                        try:
                            card_idx = card_values.index(card['value'])
                            base_idx = 12 + i * len(card_values)
                            if base_idx + card_idx < self.state_size:
                                state[base_idx + card_idx] = 1
                        except (ValueError, IndexError):
                            pass

            # Encode complete board pieces (all players).
            pieces = self.game_state.get('pieces', [])
            pieces_start = 100
            for piece in pieces:
                owner = piece.get('playerId', -1)
                piece_id = piece.get('pieceId', 1)
                if not (0 <= owner <= 3 and 1 <= piece_id <= 5):
                    continue
                base = pieces_start + ((owner * 5 + (piece_id - 1)) * 8)
                if base + 7 >= self.state_size:
                    continue
                pos = piece.get('position') or {}
                track_idx = self._track_index(pos)
                home_idx = self._home_index(pos, owner)
                state[base] = 1.0 if piece.get('inPenaltyZone') else 0.0
                state[base + 1] = 1.0 if piece.get('inHomeStretch') else 0.0
                state[base + 2] = 1.0 if piece.get('completed') else 0.0
                state[base + 3] = 1.0 if track_idx >= 0 else 0.0
                state[base + 4] = (track_idx / max(1, len(self._track) - 1)) if track_idx >= 0 else 0.0
                state[base + 5] = (home_idx / 4.0) if home_idx >= 0 else 0.0
                state[base + 6] = 1.0 if self._piece_is_threatened(piece) else 0.0
                state[base + 7] = 1.0 if self._piece_can_capture(piece) else 0.0

            # Team progress + tactical action metadata.
            counts = self.get_completed_counts()
            my_team, opp_team = self._team_split(player_id)
            state[260] = sum(counts[p] for p in my_team) / max(1, self.pieces_per_player * max(1, len(my_team)))
            state[261] = sum(counts[p] for p in opp_team) / max(1, self.pieces_per_player * max(1, len(opp_team)))
            action_summary = self._summarize_actions(player_id)
            state[262] = action_summary['move_ratio']
            state[263] = action_summary['special_ratio']
            state[264] = action_summary['discard_ratio']
            state[265] = action_summary['capture_ratio']
            state[266] = action_summary['progress_ratio']
            state[267] = action_summary['safe_ratio']
            state[268] = min(1.0, action_summary['count'] / 40.0)
            
        except Exception as e:
            warning("Error encoding state", exception=str(e))
        
        return state

    def _team_split(self, player_id: int) -> Tuple[List[int], List[int]]:
        """Return seat ids for the acting player's team and opponents."""
        teams = self.game_state.get('teams', []) if self.game_state else []
        my_team: List[int] = []
        for team in teams:
            seats = [pl.get('position') for pl in team if pl.get('position') is not None]
            if player_id in seats:
                my_team = seats
                break
        if not my_team:
            my_team = [player_id]
        opp_team = [pid for pid in range(4) if pid not in my_team]
        return my_team, opp_team

    def _piece_is_threatened(self, piece: Dict[str, Any]) -> bool:
        """Approximate whether an opponent can capture this piece soon."""
        in_penalty = piece.get('inPenaltyZone', piece.get('in_penalty'))
        in_home = piece.get('inHomeStretch', piece.get('in_home'))
        if in_penalty or in_home or piece.get('completed'):
            return False
        pos = piece.get('position') or {}
        idx = self._track_index(pos)
        if idx < 0:
            return False
        my_team, opp_team = self._team_split(piece.get('playerId', -1))
        _ = my_team
        for other in self.game_state.get('pieces', []):
            owner = other.get('playerId')
            if owner not in opp_team:
                continue
            if other.get('inPenaltyZone') or other.get('inHomeStretch') or other.get('completed'):
                continue
            o_idx = self._track_index(other.get('position') or {})
            if o_idx < 0:
                continue
            dist = (idx - o_idx + len(self._track)) % len(self._track)
            if 1 <= dist <= 7:
                return True
        return False

    def _piece_can_capture(self, piece: Dict[str, Any]) -> bool:
        """Approximate whether this piece can capture an opponent soon."""
        owner = piece.get('playerId', -1)
        in_penalty = piece.get('inPenaltyZone', piece.get('in_penalty'))
        in_home = piece.get('inHomeStretch', piece.get('in_home'))
        if owner < 0 or in_penalty or in_home or piece.get('completed'):
            return False
        pos = piece.get('position') or {}
        idx = self._track_index(pos)
        if idx < 0:
            return False
        my_team, opp_team = self._team_split(owner)
        _ = my_team
        for other in self.game_state.get('pieces', []):
            if other.get('playerId') not in opp_team:
                continue
            if other.get('inPenaltyZone') or other.get('inHomeStretch') or other.get('completed'):
                continue
            o_idx = self._track_index(other.get('position') or {})
            if o_idx < 0:
                continue
            dist = (o_idx - idx + len(self._track)) % len(self._track)
            if 1 <= dist <= 7:
                return True
        return False

    def _summarize_actions(self, player_id: int) -> Dict[str, float]:
        """Summarize legal actions into normalized metadata features."""
        actions = list(self.last_valid_actions.get(player_id, []))
        if not actions:
            return {
                'count': 0.0,
                'move_ratio': 0.0,
                'special_ratio': 0.0,
                'discard_ratio': 0.0,
                'capture_ratio': 0.0,
                'progress_ratio': 0.0,
                'safe_ratio': 0.0,
            }
        total = float(len(actions))
        specials = sum(1 for a in actions if 60 <= a < 70)
        discards = sum(1 for a in actions if a >= 70)
        moves = len(actions) - specials - discards
        return {
            'count': total,
            'move_ratio': moves / total,
            'special_ratio': specials / total,
            'discard_ratio': discards / total,
            # proxies: special moves tend to include tactical captures/progress.
            'capture_ratio': min(1.0, specials / max(1.0, total)),
            'progress_ratio': min(1.0, moves / max(1.0, total)),
            'safe_ratio': min(1.0, discards / max(1.0, total)),
        }

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
            result = [fallback[0]] if fallback else []
            self.last_valid_actions[player_id] = result
            return result

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
                result = [discard_actions[0]]
                self.last_valid_actions[player_id] = result
                return result
            fallback = self._default_discards(player_id)
            result = [fallback[0]] if fallback else []
            self.last_valid_actions[player_id] = result
            return result

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
        self.last_valid_actions[player_id] = unique_actions
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
    
    
    def step(
        self,
        action: int,
        player_id: int,
        step_count: int = 0,
        enter_home: bool = True,
    ) -> Tuple[np.ndarray, float, bool]:
        """Execute action and return next state, reward and done flag.

        If the game offers a choice to enter the home stretch, ``enter_home``
        controls whether the environment confirms the entry or skips it.
        """
        self.last_step_info = {}
        invalid_attempts = 0
        tried_actions: set = set()
        prev_pieces: Dict[str, Dict[str, Any]] = {}

        team_idx = self.player_team_map.get(player_id, 0)
        teams = self.game_state.get('teams', []) if self.game_state else []
        prev_completed = [0] * max(len(teams), 2)
        prev_completed_players = self.get_completed_counts() if self.game_state else [0]*4

        if self.game_state and 'pieces' in self.game_state:
            for p in self.game_state['pieces']:
                pid = p.get('playerId')
                if pid == player_id:
                    prev_pieces[p['id']] = {
                        'pos': p.get('position'),
                        'in_home': p.get('inHomeStretch'),
                        'in_penalty': p.get('inPenaltyZone'),
                        'completed': p.get('completed'),
                    }

        for pid, count in enumerate(prev_completed_players):
            t_idx = self.player_team_map.get(pid)
            if t_idx is not None and 0 <= t_idx < len(prev_completed):
                prev_completed[t_idx] += count

        weighted_reward = 0.0
        # Keep late-game scaling neutral by default. Capture/progress rewards
        # are multiplied by this value below, and defining it here prevents
        # runtime NameError when stepping environments.
        late_game_factor = 1.0
        # Apply a small per-step time cost so policies are encouraged to finish
        # games efficiently instead of only avoiding hard penalties.
        step_cost = STEP_PENALTY_BASE * max(1.0, self.pieces_per_player / 2.0)
        weighted_reward += step_cost
        self.reward_event_totals['step_cost'] = (
            self.reward_event_totals.get('step_cost', 0.0) + step_cost
        )
        # Escalating anti-stall penalty for long games. This starts after a
        # realistic match length and increases in fixed turn buckets.
        turn_index = int(step_count)
        if self.game_state:
            turn_index = max(turn_index, int(self.game_state.get('turnCount', turn_index)))
        if turn_index >= LONG_GAME_PENALTY_START:
            tiers = ((turn_index - LONG_GAME_PENALTY_START) // LONG_GAME_PENALTY_INTERVAL) + 1
            long_game_penalty = (
                LONG_GAME_PENALTY_BASE
                * float(tiers)
                * max(1.0, self.pieces_per_player / 2.0)
            )
            weighted_reward += long_game_penalty
            self.reward_event_counts['long_game'] += 1
            self.reward_event_totals['long_game'] += long_game_penalty



        while True:
            if not self.is_action_valid(player_id, action):
                invalid_attempts += 1
                tried_actions.add(action)
                valid_actions = self.get_valid_actions(player_id)
                alt_actions = [a for a in valid_actions if a not in tried_actions]
                if not alt_actions:
                    discard_actions = [a for a in valid_actions if a >= 70 and a not in tried_actions]
                    if not discard_actions:
                        discard_actions = [d for d in range(70, 80) if d not in tried_actions]
                    for discard in discard_actions:
                        cmd = {
                            'action': 'makeMove',
                            'playerId': player_id,
                            'actionId': discard,
                        }
                        tried_actions.add(discard)
                        response = self.send_command(cmd)
                        if response.get('success'):
                            break
                    break
                action = alt_actions[0]
                continue

            if action >= 70:
                cmd = {'action': 'makeMove', 'playerId': player_id, 'actionId': action}
            elif action >= 60:
                cmd = {'action': 'makeSpecialMove', 'playerId': player_id, 'actionId': action}
            else:
                cmd = {'action': 'makeMove', 'playerId': player_id, 'actionId': action}

            response = self.send_command(cmd)
            tried_actions.add(action)
            if response.get('action') == 'homeEntryChoice':
                cmd['enterHome'] = enter_home
                response = self.send_command(cmd)
                if not enter_home:
                    self.reward_event_counts['skip_home'] += 1
                    self.reward_event_totals['skip_home'] += SKIP_HOME_PENALTY
                    weighted_reward += SKIP_HOME_PENALTY

            if response.get('success'):
                break

            invalid_attempts += 1
            valid_actions = self.get_valid_actions(player_id)
            alt_actions = [a for a in valid_actions if a not in tried_actions]
            if not alt_actions:
                discard_actions = [a for a in valid_actions if a >= 70 and a not in tried_actions]
                if not discard_actions:
                    discard_actions = [d for d in range(70, 80) if d not in tried_actions]
                for discard in discard_actions:
                    cmd = {
                        'action': 'makeMove',
                        'playerId': player_id,
                        'actionId': discard,
                    }
                    tried_actions.add(discard)
                    response = self.send_command(cmd)
                    if response.get('success'):
                        break
                    invalid_attempts += 1
                break

            action = alt_actions[0]

        done = response.get('gameEnded', False)

        # Invalid moves no longer incur a penalty

        if 'gameState' in response:
            self.game_state = response['gameState']
            self.game_state['gameEnded'] = done
            self.game_state['winningTeam'] = response.get('winningTeam')
            self.sync_local_completion_flags()
            if 'stats' in response:
                self.game_state['stats'] = response['stats'].get('full', {})
                summary = response['stats'].get('summary')
                if isinstance(summary, dict):
                    summary['heavyRewards'] = self.heavy_reward_events
                self.game_state['statsSummary'] = summary
            last_move = self.game_state.get('lastMove')
            if last_move is not None:
                try:
                    state_copy = json.loads(json.dumps(self.game_state))
                except Exception:
                    state_copy = self.game_state
                self.move_history.append({'move': str(last_move), 'state': state_copy})

        teams_now = self.game_state.get('teams', []) if self.game_state else []
        my_team: List[int] = []
        opponent_team: List[int] = []
        for team in teams_now:
            seats = [pl.get('position') for pl in team if 'position' in pl]
            if player_id in seats:
                my_team = seats
            else:
                opponent_team.extend(seats)

        capture_occurred = bool(response.get('captures'))
        piece_reward = 0.0
        progress_reward = 0.0
        safe_reward = 0.0
        new_pieces = {p['id']: p for p in self.game_state.get('pieces', [])}
        for pid, prev in prev_pieces.items():
            new = new_pieces.get(pid)
            if not new:
                continue
            owner = new.get('playerId')
            if owner not in my_team:
                continue
            if not prev.get('completed') and new.get('completed'):
                piece_reward += PIECE_COMPLETION_REWARD
                self.reward_event_counts['home_completion'] += 1
                self.reward_event_totals['home_completion'] += PIECE_COMPLETION_REWARD
            prev_steps = self._steps_to_entrance(prev.get('pos') or {}, owner)
            new_steps = self._steps_to_entrance(new.get('position') or {}, owner)
            if prev_steps >= 0 and new_steps >= 0 and new_steps < prev_steps:
                delta = REWARD_WEIGHTS.get('home_entry_progress', 2.0) * min(5, prev_steps - new_steps) / 5.0
                progress_reward += delta
            if self._piece_is_threatened({'playerId': owner, **prev}) and not self._piece_is_threatened(new):
                safe_reward += REWARD_WEIGHTS.get('safe_move', 1.0)

        if capture_occurred:
            cap = REWARD_WEIGHTS.get('capture', 6.0) * late_game_factor
            self.reward_event_counts['capture'] += 1
            self.reward_event_totals['capture'] += cap
            weighted_reward += cap

        if progress_reward > 0:
            progress_reward *= late_game_factor
            self.reward_event_counts['home_entry_progress'] += 1
            self.reward_event_totals['home_entry_progress'] += progress_reward
            weighted_reward += progress_reward

        if safe_reward > 0:
            self.reward_event_counts['safe_move'] += 1
            self.reward_event_totals['safe_move'] += safe_reward
            weighted_reward += safe_reward

        weighted_reward += piece_reward

        self.player_team_map = {}
        for idx, team in enumerate(teams_now):
            for pl in team:
                pos = pl.get('position')
                if pos is not None:
                    self.player_team_map[int(pos)] = idx

        new_completed = [0] * max(len(teams_now), 2)
        new_completed_players = self.get_completed_counts()
        for pid, count in enumerate(new_completed_players):
            t_idx = self.player_team_map.get(pid)
            if t_idx is not None and 0 <= t_idx < len(new_completed):
                new_completed[t_idx] += count

        if not done and teams_now:
            winner = self._check_team_completion(teams_now, new_completed)
            if winner is not None:
                done = True
                self.game_state['winningTeam'] = winner

        if done and self.game_state.get('winningTeam'):
            winning_positions = [pl.get('position') for pl in self.game_state.get('winningTeam', [])]
            winning_idx = None
            for idx, team in enumerate(teams_now):
                team_pos = [pl.get('position') for pl in team if 'position' in pl]
                if set(team_pos) == set(winning_positions):
                    winning_idx = idx
                    break
            if winning_idx is not None:
                my_idx = self.player_team_map.get(player_id, 0)
                if winning_idx == my_idx:
                    win_reward = self.win_bonus if self.win_bonus != 0 else REWARD_WEIGHTS.get('win', 20.0)
                    self.reward_event_counts['win'] += 1
                    self.reward_event_totals['win'] += win_reward
                    self.reward_bonus_totals['win_bonus'] += win_reward
                    weighted_reward += win_reward
                    self.last_step_info['win_bonus'] = win_reward
                    turn_count = float(self.game_state.get('turnCount', step_count))
                    if self.turn_limit > 0:
                        speed_fraction = max(0.0, (self.turn_limit - turn_count) / self.turn_limit)
                        fast_finish_bonus = FAST_FINISH_BONUS_SCALE * speed_fraction
                    else:
                        fast_finish_bonus = 0.0
                    if fast_finish_bonus > 0:
                        weighted_reward += fast_finish_bonus
                        self.reward_event_totals['fast_finish_bonus'] = (
                            self.reward_event_totals.get('fast_finish_bonus', 0.0)
                            + fast_finish_bonus
                        )
                        self.reward_bonus_totals['fast_finish_bonus'] = (
                            self.reward_bonus_totals.get('fast_finish_bonus', 0.0)
                            + fast_finish_bonus
                        )
                        self.last_step_info['fast_finish_bonus'] = fast_finish_bonus
                else:
                    loss_penalty = REWARD_WEIGHTS.get('loss', -10.0)
                    self.reward_event_counts['loss'] += 1
                    self.reward_event_totals['loss'] += loss_penalty
                    weighted_reward += loss_penalty

        low, high = REWARD_CLIP_RANGE
        reward = float(np.clip(weighted_reward, low, high))

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

    def reset_reward_events(self) -> None:
        """Clear tracked reward event counts."""
        for key in self.reward_event_counts:
            self.reward_event_counts[key] = 0
        for key in self.reward_event_totals:
            self.reward_event_totals[key] = 0.0
        for key in self.reward_bonus_totals:
            self.reward_bonus_totals[key] = 0.0
        self.heavy_reward_events = 0
        for key in self.heavy_reward_breakdown:
            self.heavy_reward_breakdown[key] = 0
        self.pending_penalties = [0.0] * 4
        self.next_penalty_check = 60
        self.completion_delay_turns = [0, 0]
        self.no_progress_steps = [
            {'general': 0, 'since_two': 0} for _ in range(4)
        ]
        self.last_step_info = {}

    def set_heavy_reward(self, value: float) -> None:
        """Update the weight applied to major reward events."""
        self.heavy_reward = float(value)

    def set_win_bonus(self, value: float) -> None:
        """Update the win bonus applied when a team wins."""
        self.win_bonus = float(value)

    def set_turn_limit(self, turns: int) -> None:
        """Update the maximum turns per episode."""
        self.turn_limit = int(turns)

    def set_piece_count(self, pieces: int) -> None:
        """Update the number of pieces per player for new games."""
        self.pieces_per_player = max(1, min(5, int(pieces)))
        # Positive reward scale remains constant under the simplified rules
        self.positive_reward_scale = 1.0

    def reseed(self, seed: int) -> None:
        """Reseed any environment RNGs."""
        np.random.seed(seed)

    def sync_local_completion_flags(self) -> None:
        """Ensure pieces on the final home-stretch cell are marked completed."""
        for pid in range(4):
            if pid >= len(self._home_stretches):
                continue
            stretch = self._home_stretches[pid]
            if not stretch:
                continue
            last = stretch[-1]
            for piece in self.game_state.get('pieces', []):
                if piece.get('playerId') != pid:
                    continue
                pos = piece.get('position') or {}
                if (
                    pos.get('row') == last['row']
                    and pos.get('col') == last['col']
                    and not piece.get('completed')
                ):
                    piece['inHomeStretch'] = True
                    piece['completed'] = True

    def count_completed_pieces(self, player_id: int) -> int:
        """Return how many pieces are fully completed for ``player_id``."""

        count = 0
        for p in self.game_state.get('pieces', []):
            if p.get('playerId') == player_id and p.get('completed'):
                count += 1
        return count

    def get_completed_counts(self) -> List[int]:
        """Return completed piece counts for all players."""
        counts = []
        for pid in range(4):
            counts.append(self.count_completed_pieces(pid))
        return counts

    def _check_team_completion(
        self, teams: List[List[Dict[str, int]]], completed: List[int]
    ) -> Optional[List[Dict[str, int]]]:
        """Return the winning team if any team has finished all pieces."""

        target = self.pieces_per_player * 2
        for idx, team in enumerate(teams):
            if completed[idx] >= target:
                self.game_state['gameEnded'] = True
                self.game_state['winningTeam'] = team
                return team
        return None

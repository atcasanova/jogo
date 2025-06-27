"""Run tournaments between saved bot models in text mode."""

import os
import random
from collections import defaultdict
from typing import Dict, List

from ai.environment import GameEnvironment
from ai.bot import GameBot, DQNBot
from config import MODEL_DIR, LOG_DIR


MAX_STEPS = 1000

def shuffle_bots(bots: List[GameBot]) -> None:
    """Randomize seating while keeping fixed teams."""
    team0 = [b for b in bots if getattr(b, "team", 0) == 0]
    team1 = [b for b in bots if getattr(b, "team", 0) == 1]
    random.shuffle(team0)
    random.shuffle(team1)
    bots[:] = [team0[0], team1[0], team0[1], team1[1]]
    for idx, bot in enumerate(bots):
        bot.player_id = idx


def update_partner_stats(
    stats: Dict[int, Dict[int, Dict[str, int]]], bots: List[GameBot], winners: List[int]
) -> None:
    """Record outcome for each bot pair."""
    winning_team = None
    if winners:
        winning_team = 0 if winners[0] in {0, 2} else 1

    teams = [(0, 2), (1, 3)]
    for idx, (a, b) in enumerate(teams):
        bot_a = bots[a]
        bot_b = bots[b]
        entry_a = stats[bot_a.bot_id][bot_b.bot_id]
        entry_b = stats[bot_b.bot_id][bot_a.bot_id]
        entry_a["games"] += 1
        entry_b["games"] += 1
        if idx == winning_team:
            entry_a["wins"] += 1
            entry_b["wins"] += 1

def list_model_dirs() -> List[str]:
    """Return available subdirectories in ``models/`` containing bot files."""
    dirs = []
    if not os.path.exists(MODEL_DIR):
        return dirs

    for entry in sorted(os.listdir(MODEL_DIR)):
        path = os.path.join(MODEL_DIR, entry)
        if not os.path.isdir(path):
            continue
        if any(f.startswith("bot_") and f.endswith(".pth") for f in os.listdir(path)):
            dirs.append(entry)
    return dirs

def choose_dir(name: str, options: List[str]) -> str:
    """Prompt the user to select a model directory."""
    print(f"Select model directory for {name}:")
    for idx, option in enumerate(options):
        print(f"  {idx}: {option}")

    while True:
        choice = input("Enter number: ")
        try:
            idx = int(choice)
            if 0 <= idx < len(options):
                return options[idx]
        except ValueError:
            pass
        print("Invalid selection, try again.")


def load_bots(env: GameEnvironment, dirs: List[str]) -> List[GameBot]:
    """Create bots for the environment and load their models."""
    bots = []
    for seat, dname in enumerate(dirs):
        model_path = os.path.join(MODEL_DIR, dname, f"bot_{seat}.pth")
        bot: GameBot
        bot = GameBot(
            player_id=seat,
            state_size=env.state_size,
            action_size=env.action_space_size,
            bot_id=seat,
        )
        if os.path.exists(model_path):
            try:
                bot.load_model(model_path, reset_stats=True)
            except (KeyError, ValueError) as e:
                print(f"Failed to load {model_path} as PPO: {e}")
                print("Trying DQN format...")
                bot = DQNBot(
                    player_id=seat,
                    state_size=env.state_size,
                    action_size=env.action_space_size,
                    bot_id=seat,
                )
                try:
                    bot.load_model(model_path, reset_stats=True)
                except (KeyError, ValueError) as e2:
                    print(f"Failed to load {model_path} as DQN: {e2}")
                    print("Using untrained bot instead")
        else:
            print(f"Warning: {model_path} not found; using untrained bot")
        bot.model_dir = dname
        bot.team = 0 if seat in (0, 2) else 1
        bots.append(bot)
    return bots

def play_game(env: GameEnvironment, bots: List[GameBot]) -> List[int]:
    """Run a single game without training.

    Returns
    -------
    List[int]
        The positions of any winning players, or an empty list if no winner.
    """
    bot_names = [f"Bot_{b.bot_id}" for b in bots]
    env.reset(bot_names=bot_names)
    step = 0
    done = False
    while not done and step < MAX_STEPS:
        current_player = env.game_state.get("currentPlayerIndex", 0)
        bot = bots[current_player]
        state = env.get_state(current_player)
        actions = env.get_valid_actions(current_player)
        if not actions:
            break
        action = bot.act(state, actions)
        _, _, done = env.step(action, current_player)
        step += 1

    winners: List[int] = []
    if env.game_state.get("winningTeam"):
        for pl in env.game_state["winningTeam"]:
            pos = pl.get("position")
            if pos is not None and 0 <= pos < len(bots):
                bots[pos].wins += 1
                winners.append(pos)
    for b in bots:
        b.games_played += 1

    return winners


def main() -> None:
    options = list_model_dirs()
    if len(options) < 1:
        print("No model directories found in 'models/'")
        return

    team0 = choose_dir("Team 0 (seats 0 & 2)", options)
    team1 = choose_dir("Team 1 (seats 1 & 3)", options)
    seats = [team0, team1, team0, team1]

    env = GameEnvironment()
    if not env.start_node_game():
        print("Failed to start game process")
        return

    os.makedirs(LOG_DIR, exist_ok=True)

    bots = load_bots(env, seats)

    partner_stats: Dict[int, Dict[int, Dict[str, int]]] = defaultdict(
        lambda: defaultdict(lambda: {"wins": 0, "games": 0})
    )

    num_games = 100
    print(f"Running {num_games} games...\n")
    for i in range(num_games):
        shuffle_bots(bots)
        winners = play_game(env, bots)
        update_partner_stats(partner_stats, bots, winners)
        if winners:
            team0_seats = sorted(b.player_id for b in bots if b.team == 0)
            team1_seats = sorted(b.player_id for b in bots if b.team == 1)
            team0_name = next(b.model_dir for b in bots if b.team == 0)
            team1_name = next(b.model_dir for b in bots if b.team == 1)
            fname = (
                f"{team0_name}_p{team0_seats[0]}_p{team0_seats[1]}_vs_"
                f"{team1_name}_p{team1_seats[0]}_p{team1_seats[1]}.json"
            )
            env.save_history(os.path.join(LOG_DIR, fname))
            print(
                f"Game {i + 1}: winners {', '.join(str(w) for w in winners)}"
            )
        else:
            print(f"Game {i + 1}: no winner")

        env.reset()

        if (i + 1) % 10 == 0:
            print(f"Completed {i + 1} games")
            for b in sorted(bots, key=lambda bot: bot.bot_id):
                win_rate = b.wins / b.games_played if b.games_played else 0
                print(
                    f"Bot {b.bot_id} ({b.algorithm}) from {b.model_dir} - "
                    f"wins: {b.wins}/{b.games_played} ({win_rate:.2%})"
                )
                for pid, stat in partner_stats[b.bot_id].items():
                    rate = stat["wins"] / stat["games"] if stat["games"] else 0
                    print(
                        f"  With Bot {pid}: {stat['wins']}/{stat['games']} "
                        f"({rate:.2%})"
                    )

    env.close()

    for b in sorted(bots, key=lambda bot: bot.bot_id):
        win_rate = b.wins / b.games_played if b.games_played else 0
        print(
            f"Bot {b.bot_id} ({b.algorithm}) from {b.model_dir} - "
            f"wins: {b.wins}/{b.games_played} ({win_rate:.2%})"
        )
        for pid, stat in partner_stats[b.bot_id].items():
            rate = stat["wins"] / stat["games"] if stat["games"] else 0
            print(
                f"  With Bot {pid}: {stat['wins']}/{stat['games']} "
                f"({rate:.2%})"
            )


if __name__ == "__main__":
    main()

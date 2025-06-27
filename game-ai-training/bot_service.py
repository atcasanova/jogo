import json
import os
import sys

from ai.environment import GameEnvironment
from ai.bot import GameBot, DQNBot
from json_logger import info
import torch


def load_bots(model_dir: str):
    env = GameEnvironment()
    bots = []
    for i in range(4):
        path = os.path.join(model_dir, f"bot_{i}.pth")

        checkpoint = None
        if os.path.exists(path):
            try:
                checkpoint = torch.load(path, map_location="cpu")
            except Exception:
                checkpoint = None

        if checkpoint and "q_network_state_dict" in checkpoint and "model_state_dict" not in checkpoint:
            bot = DQNBot(i, env.state_size, env.action_space_size, device="cpu")
        else:
            bot = GameBot(i, env.state_size, env.action_space_size, device="cpu")

        if os.path.exists(path):
            try:
                bot.load_model(path)
                info("Loaded model", bot=i, algorithm=bot.algorithm)
            except Exception as e:
                info("Failed to load model", bot=i, error=str(e))
        bots.append(bot)
    return env, bots


def main():
    model_dir = os.environ.get("BOT_MODEL_DIR", "models/final")
    env, bots = load_bots(model_dir)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            continue
        if cmd.get("cmd") == "predict":
            env.game_state = cmd.get("gameState", {})
            pid = int(cmd.get("playerId", 0))
            valid = cmd.get("validActions", [])
            state = env.get_state(pid)
            action = bots[pid].act(state, valid)
            print(json.dumps({"actionId": action}), flush=True)
        elif cmd.get("cmd") == "quit":
            break


if __name__ == "__main__":
    main()

import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
from typing import List, Tuple
import threading

from config import TRAINING_CONFIG
from json_logger import info


class ActorCritic(nn.Module):
    """Simple actor-critic network used by PPO."""

    def __init__(self, state_size: int, action_size: int, hidden_size: int = 512):
        super().__init__()
        self.shared = nn.Sequential(
            nn.Linear(state_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, hidden_size),
            nn.ReLU(),
        )
        self.policy_head = nn.Linear(hidden_size, action_size)
        self.value_head = nn.Linear(hidden_size, 1)

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        features = self.shared(x)
        return self.policy_head(features), self.value_head(features)


class GameBot:
    """PPO-based game bot."""

    def __init__(self, player_id: int, state_size: int, action_size: int, device: str = None):
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        info("Bot using device", bot=player_id, device=str(self.device))

        self.player_id = player_id
        self.state_size = state_size
        self.action_size = action_size

        self.model = ActorCritic(state_size, action_size, TRAINING_CONFIG['hidden_size']).to(self.device)
        self.optimizer = optim.Adam(self.model.parameters(), lr=TRAINING_CONFIG['learning_rate'])

        self.gamma = TRAINING_CONFIG['gamma']
        self.clip_eps = TRAINING_CONFIG.get('ppo_clip', 0.2)
        self.entropy_weight = TRAINING_CONFIG.get('entropy_weight', 0.01)
        self.batch_size = TRAINING_CONFIG['batch_size']
        self.train_freq = TRAINING_CONFIG['train_freq']
        # Number of steps between calls to update_target_network().
        # Some configs (e.g. quick_start.sh) override this value.
        self.update_target_freq = TRAINING_CONFIG.get('update_target_freq', 1000)
        self.step_count = 0

        self.epsilon = 0.0

        self.memory: List[Tuple] = []
        self.lock = threading.Lock()

        self.wins = 0
        self.games_played = 0
        self.total_reward = 0.0
        self.losses: List[float] = []

        self.last_log_prob = None
        self.last_value = None

    def act(self, state: np.ndarray, valid_actions: List[int]) -> int:
        state_t = torch.FloatTensor(state).unsqueeze(0).to(self.device)
        logits, value = self.model(state_t)

        mask = torch.full_like(logits, float('-inf'))
        for a in valid_actions:
            if a < self.action_size:
                mask[0, a] = 0.0
        logits = logits + mask
        probs = torch.softmax(logits, dim=-1)
        dist = torch.distributions.Categorical(probs)
        action = dist.sample()

        self.last_log_prob = dist.log_prob(action)
        self.last_value = value.squeeze(0)
        return int(action.item())

    def remember(self, state, action, reward, next_state, done):
        self.memory.append((state, action, reward, done, self.last_log_prob, self.last_value))

    def replay(self):
        if len(self.memory) < self.batch_size:
            return

        states, actions, rewards, dones, log_probs, values = zip(*self.memory)
        self.memory = []

        states_t = torch.FloatTensor(np.array(states)).to(self.device)
        actions_t = torch.LongTensor(actions).to(self.device)
        rewards_t = torch.FloatTensor(rewards).to(self.device)
        dones_t = torch.FloatTensor(dones).to(self.device)
        old_log_probs_t = torch.stack(log_probs).to(self.device)
        values_t = torch.stack(values).to(self.device)

        returns = []
        R = 0.0
        for r, d in zip(reversed(rewards_t.tolist()), reversed(dones_t.tolist())):
            if d:
                R = 0.0
            R = r + self.gamma * R
            returns.insert(0, R)
        returns_t = torch.FloatTensor(returns).to(self.device)
        advantages = returns_t - values_t.detach()

        logits, new_values = self.model(states_t)
        logit_mask = torch.full_like(logits, float('-inf'))
        for idx, acts in enumerate([list(range(self.action_size))] * len(states_t)):
            for a in acts:
                logit_mask[idx, a] = 0.0
        logits = logits + logit_mask
        probs = torch.softmax(logits, dim=-1)
        dist = torch.distributions.Categorical(probs)
        new_log_probs = dist.log_prob(actions_t)
        entropy = dist.entropy().mean()

        ratio = (new_log_probs - old_log_probs_t.detach()).exp()
        surr1 = ratio * advantages
        surr2 = torch.clamp(ratio, 1.0 - self.clip_eps, 1.0 + self.clip_eps) * advantages
        actor_loss = -torch.min(surr1, surr2).mean()
        critic_loss = nn.functional.mse_loss(new_values.squeeze(-1), returns_t)
        loss = actor_loss + 0.5 * critic_loss - self.entropy_weight * entropy

        self.optimizer.zero_grad()
        loss.backward()
        self.optimizer.step()

        self.losses.append(float(loss.item()))

    def update_target_network(self):
        pass

    def save_model(self, filepath: str) -> None:
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'wins': self.wins,
            'games_played': self.games_played,
            'total_reward': self.total_reward,
        }, filepath)

    def load_model(self, filepath: str) -> None:
        checkpoint = torch.load(filepath, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        self.wins = checkpoint.get('wins', 0)
        self.games_played = checkpoint.get('games_played', 0)
        self.total_reward = checkpoint.get('total_reward', 0.0)

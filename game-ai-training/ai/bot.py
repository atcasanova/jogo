import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
from typing import List, Tuple
import threading

from config import TRAINING_CONFIG
from json_logger import info

# Fallback when torch.nn.Module is mocked during tests
BASE_MODULE = nn.Module if isinstance(nn.Module, type) else object


class ActorCritic(BASE_MODULE):
    """Simple actor-critic network used by PPO."""

    def __init__(self, state_size: int, action_size: int, hidden_size: int = 512):
        if hasattr(super(), '__init__'):
            super().__init__()
        self.shared = nn.Sequential(
            nn.Linear(state_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, hidden_size),
            nn.ReLU(),
        )
        self.policy_head = nn.Linear(hidden_size, action_size)
        self.value_head = nn.Linear(hidden_size, 1)

    def to(self, device):
        if hasattr(super(), 'to'):
            return super().to(device)
        return self

    def parameters(self):
        if hasattr(super(), 'parameters'):
            return super().parameters()
        return []

    def load_state_dict(self, state_dict, strict: bool = True):
        """Load weights into the network.

        Parameters
        ----------
        state_dict : dict
            Model weights to load.
        strict : bool, optional
            Whether to strictly enforce that the keys in ``state_dict`` match
            the model's keys. Defaults to ``True``.
        """
        if hasattr(super(), 'load_state_dict'):
            return super().load_state_dict(state_dict, strict=strict)
        return None

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        features = self.shared(x)
        return self.policy_head(features), self.value_head(features)


class GameBot:
    """PPO-based game bot."""

    def __init__(self, player_id: int, state_size: int, action_size: int, device: str = None, bot_id: int = None):
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        info("Bot using device", bot=bot_id if bot_id is not None else player_id, device=str(self.device))

        self.player_id = player_id
        self.bot_id = bot_id if bot_id is not None else player_id
        self.algorithm = 'PPO'
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
        self.last_entropy = 0.0
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
        self.last_entropy = dist.entropy().item()
        self.last_value = value.squeeze(0)
        return int(action.item())

    def remember(self, state, action, reward, next_state, done, game_won=False, extra_advantage: float = 0.0):
        """Store a transition in memory."""
        self.memory.append(
            (
                state,
                action,
                reward,
                done,
                self.last_log_prob,
                self.last_value,
                self.last_entropy,
                game_won,
                extra_advantage,
            )
        )

    def replay(self):
        if len(self.memory) < self.batch_size:
            return None

        states, actions, rewards, dones, log_probs, values, entropies, game_wons, extra_advs = zip(*self.memory)
        self.memory = []

        states_t = torch.FloatTensor(np.array(states)).to(self.device)
        actions_t = torch.LongTensor(actions).to(self.device)
        rewards_t = torch.FloatTensor(rewards).to(self.device)
        dones_t = torch.FloatTensor(dones).to(self.device)
        entropies_t = torch.FloatTensor(entropies).to(self.device)
        game_wons_t = torch.FloatTensor(game_wons).to(self.device)
        extra_advs_t = torch.FloatTensor(extra_advs).to(self.device)
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
        advantages += extra_advs_t
        # Normalise advantages per batch to stabilise updates
        adv_mean = advantages.mean()
        adv_std = advantages.std(unbiased=False)
        advantages = (advantages - adv_mean) / (adv_std + 1e-6)

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
        approx_kl = (old_log_probs_t.detach() - new_log_probs).mean().item()

        ratio = (new_log_probs - old_log_probs_t.detach()).exp()
        surr1 = ratio * advantages
        surr2 = torch.clamp(ratio, 1.0 - self.clip_eps, 1.0 + self.clip_eps) * advantages
        mask = (ratio > 1.0 + self.clip_eps) | (ratio < 1.0 - self.clip_eps)
        clipfrac = mask.float().mean().item()
        actor_loss = -torch.min(surr1, surr2).mean()
        critic_loss = nn.functional.mse_loss(new_values.squeeze(-1), returns_t)
        loss = actor_loss + 0.5 * critic_loss - self.entropy_weight * entropy

        self.optimizer.zero_grad()
        loss.backward()
        self.optimizer.step()

        self.losses.append(float(loss.item()))

        return approx_kl, clipfrac, float(entropies_t.mean().item())

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

    def load_model(self, filepath: str, reset_stats: bool = False) -> None:
        """Load model weights and optionally ignore stored statistics.

        Raises
        ------
        ValueError
            If the checkpoint uses an unsupported legacy format.
        """
        checkpoint = torch.load(filepath, map_location=self.device)

        if 'model_state_dict' in checkpoint:
            self.model.load_state_dict(checkpoint['model_state_dict'])
            if 'optimizer_state_dict' in checkpoint:
                self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        elif 'q_network_state_dict' in checkpoint:
            raise ValueError(
                "Legacy DQN checkpoint detected; this version cannot load models "
                "saved before the PPO migration."
            )
        else:
            raise KeyError('model_state_dict')

        if reset_stats:
            self.wins = 0
            self.games_played = 0
            self.total_reward = 0.0
        else:
            self.wins = checkpoint.get('wins', 0)
            self.games_played = checkpoint.get('games_played', 0)
            self.total_reward = checkpoint.get('total_reward', 0.0)


class DQNNet(BASE_MODULE):
    """Simple feed-forward network for DQN models."""

    def __init__(self, state_size: int, action_size: int, hidden_size: int = 512):
        if hasattr(super(), '__init__'):
            super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(state_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, action_size),
        )

    def to(self, device):
        if hasattr(super(), 'to'):
            return super().to(device)
        return self

    def parameters(self):
        if hasattr(super(), 'parameters'):
            return super().parameters()
        return []

    def load_state_dict(self, state_dict, strict: bool = True):
        """Load network weights from ``state_dict``.

        Parameters
        ----------
        state_dict : dict
            Weights to load into the model.
        strict : bool, optional
            Enforce that the keys in ``state_dict`` match the keys expected by
            this module. Defaults to ``True``.
        """
        if hasattr(super(), 'load_state_dict'):
            return super().load_state_dict(state_dict, strict=strict)
        return None

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.layers(x)


class DQNBot:
    """Legacy DQN-based bot used for backwards compatibility."""

    def __init__(self, player_id: int, state_size: int, action_size: int, device: str = None, bot_id: int = None):
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        info("Bot using device", bot=bot_id if bot_id is not None else player_id, device=str(self.device))

        self.player_id = player_id
        self.bot_id = bot_id if bot_id is not None else player_id
        self.algorithm = 'DQN'
        self.state_size = state_size
        self.action_size = action_size

        self.model = DQNNet(state_size, action_size, TRAINING_CONFIG['hidden_size']).to(self.device)
        self.optimizer = optim.Adam(self.model.parameters(), lr=TRAINING_CONFIG['learning_rate'])

        self.epsilon = 0.0
        self.wins = 0
        self.games_played = 0
        self.total_reward = 0.0

    def act(self, state: np.ndarray, valid_actions: List[int]) -> int:
        state_t = torch.FloatTensor(state).unsqueeze(0).to(self.device)
        q_values = self.model(state_t)

        mask = torch.full_like(q_values, float('-inf'))
        for a in valid_actions:
            if a < self.action_size:
                mask[0, a] = 0.0
        q_values = q_values + mask

        return int(torch.argmax(q_values, dim=-1).item())

    def remember(self, *args, **kwargs):
        pass

    def replay(self):
        pass

    def update_target_network(self):
        pass

    def save_model(self, filepath: str) -> None:
        torch.save({
            'q_network_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'wins': self.wins,
            'games_played': self.games_played,
            'total_reward': self.total_reward,
        }, filepath)

    def load_model(self, filepath: str, reset_stats: bool = False) -> None:
        """Load weights from a legacy DQN checkpoint.

        Parameters
        ----------
        filepath : str
            Path to the saved model file.
        reset_stats : bool, optional
            If ``True`` ignore stored win statistics.
        """
        checkpoint = torch.load(filepath, map_location=self.device)

        if 'q_network_state_dict' in checkpoint:
            state_dict = checkpoint['q_network_state_dict']
            try:
                self.model.load_state_dict(state_dict)
            except RuntimeError:
                # Support older checkpoints that used the "network" prefix
                remapped = {}
                for key, value in state_dict.items():
                    if key.startswith('network.'):
                        remapped['layers.' + key[len('network.'):]] = value
                    else:
                        remapped[key] = value
                self.model.load_state_dict(remapped, strict=False)
            if 'optimizer_state_dict' in checkpoint:
                try:
                    self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
                except ValueError:
                    # Optimizer state may not match when loading legacy models
                    pass
        elif 'model_state_dict' in checkpoint:
            raise ValueError('PPO checkpoint detected; use GameBot to load')
        else:
            raise KeyError('q_network_state_dict')

        if reset_stats:
            self.wins = 0
            self.games_played = 0
            self.total_reward = 0.0
        else:
            self.wins = checkpoint.get('wins', 0)
            self.games_played = checkpoint.get('games_played', 0)
            self.total_reward = checkpoint.get('total_reward', 0.0)

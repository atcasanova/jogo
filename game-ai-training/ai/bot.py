import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
import random
from collections import deque
import threading

from config import TRAINING_CONFIG
from json_logger import info

class DQN(nn.Module):
    def __init__(self, state_size, action_size, hidden_size=512):
        super(DQN, self).__init__()
        self.network = nn.Sequential(
            nn.Linear(state_size, hidden_size),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(hidden_size, hidden_size),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(hidden_size, hidden_size // 2),
            nn.ReLU(),
            nn.Linear(hidden_size // 2, action_size)
        )
    
    def forward(self, x):
        return self.network(x)

class GameBot:
    def __init__(self, player_id, state_size, action_size, device=None):
        """Initialize a bot and move models to the selected device."""

        # Set device. Allow explicit device to be passed so bots can be
        # distributed across multiple GPUs when available.
        if device is None:
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(device)

        info("Bot using device", bot=player_id, device=str(self.device))
       
        self.player_id = player_id
        self.state_size = state_size
        self.action_size = action_size
        
        # Neural networks - move to GPU
        self.q_network = DQN(state_size, action_size, TRAINING_CONFIG['hidden_size']).to(self.device)
        self.target_network = DQN(state_size, action_size, TRAINING_CONFIG['hidden_size']).to(self.device)
        self.optimizer = optim.Adam(self.q_network.parameters(), lr=TRAINING_CONFIG['learning_rate'])
        
        # Experience replay
        self.memory = deque(maxlen=TRAINING_CONFIG['memory_size'])
        self.batch_size = TRAINING_CONFIG['batch_size']
        
        # Exploration parameters
        self.epsilon = TRAINING_CONFIG['epsilon_start']
        self.epsilon_min = TRAINING_CONFIG['epsilon_min']
        self.epsilon_decay = TRAINING_CONFIG['epsilon_decay']
        
        # Training parameters
        self.gamma = TRAINING_CONFIG['gamma']
        self.update_target_freq = TRAINING_CONFIG['update_target_freq']
        self.train_freq = TRAINING_CONFIG['train_freq']
        self.step_count = 0
        
        # Statistics
        self.wins = 0
        self.games_played = 0
        self.total_reward = 0
        self.losses = []

        # Synchronization lock for multi-threaded training
        self.lock = threading.Lock()
    
    def remember(self, state, action, reward, next_state, done):
        """Store experience in replay buffer"""
        self.memory.append((state, action, reward, next_state, done))
    
    def act(self, state, valid_actions):
        """Choose action using epsilon-greedy policy"""
        if np.random.random() <= self.epsilon:
            return random.choice(valid_actions)
        
        # Move state to GPU
        state_tensor = torch.FloatTensor(state).unsqueeze(0).to(self.device)
        q_values = self.q_network(state_tensor)
        
        # Mask invalid actions
        masked_q_values = q_values.clone()
        mask = torch.full_like(masked_q_values, float('-inf'))
        for action in valid_actions:
            if action < self.action_size:
                mask[0][action] = 0
        masked_q_values += mask
        
        return masked_q_values.argmax().item()
    
    def replay(self):
        """Train the model on a batch of experiences"""
        if len(self.memory) < self.batch_size:
            return

        batch = random.sample(self.memory, self.batch_size)

        # Move tensors to GPU
        states = torch.FloatTensor(np.array([e[0] for e in batch])).to(self.device)
        actions = torch.LongTensor(np.array([e[1] for e in batch])).to(self.device)
        rewards = torch.FloatTensor(np.array([e[2] for e in batch])).to(self.device)
        next_states = torch.FloatTensor(np.array([e[3] for e in batch])).to(self.device)
        dones = torch.BoolTensor(np.array([e[4] for e in batch])).to(self.device)
        
        current_q_values = self.q_network(states).gather(1, actions.unsqueeze(1))
        next_q_values = self.target_network(next_states).max(1)[0].detach()
        target_q_values = rewards + (self.gamma * next_q_values * ~dones)
        
        loss = nn.MSELoss()(current_q_values.squeeze(), target_q_values)
        
        with self.lock:
            self.optimizer.zero_grad()
            loss.backward()
            self.optimizer.step()
        
        self.losses.append(loss.item())
        
        if self.epsilon > self.epsilon_min:
            self.epsilon *= self.epsilon_decay
    
    def update_target_network(self):
        """Copy weights from main network to target network"""
        with self.lock:
            self.target_network.load_state_dict(self.q_network.state_dict())
    
    def save_model(self, filepath):
        """Save the trained model"""
        torch.save({
            'q_network_state_dict': self.q_network.state_dict(),
            'target_network_state_dict': self.target_network.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'epsilon': self.epsilon,
            'wins': self.wins,
            'games_played': self.games_played,
            'total_reward': self.total_reward
        }, filepath)
    
    def load_model(self, filepath):
        """Load a trained model"""
        checkpoint = torch.load(filepath, map_location=self.device)
        self.q_network.load_state_dict(checkpoint['q_network_state_dict'])
        self.target_network.load_state_dict(checkpoint['target_network_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        self.epsilon = checkpoint['epsilon']
        self.wins = checkpoint['wins']
        self.games_played = checkpoint['games_played']
        self.total_reward = checkpoint['total_reward']


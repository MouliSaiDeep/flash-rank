// ─── API endpoints and state configuration ──────────────────────────────────────
let activeRoundTimer = null;
let currentRoundEndTime = null;
let currentRoundDuration = 0;

// Local active session state
let userSession = {
  userId: null,
  sessionId: null,
  ipAddress: null,
  deviceType: null
};

// ─── SVG Avatar Generator based on seed string ───────────────────────────────────
function getSvgAvatarMarkup(seed) {
  if (!seed) seed = "guest";
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color1 = `hsl(${Math.abs(hash) % 360}, 85%, 60%)`;
  const color2 = `hsl(${Math.abs(hash + 130) % 360}, 80%, 40%)`;
  const shapeIndex = Math.abs(hash) % 4;
  
  let shapes = '';
  if (shapeIndex === 0) {
    shapes = `<circle cx="50" cy="50" r="28" fill="url(#grad-${Math.abs(hash)})" />`;
  } else if (shapeIndex === 1) {
    shapes = `<rect x="24" y="24" width="52" height="52" rx="14" fill="url(#grad-${Math.abs(hash)})" />`;
  } else if (shapeIndex === 2) {
    shapes = `<polygon points="50,20 82,75 18,75" fill="url(#grad-${Math.abs(hash)})" />`;
  } else {
    shapes = `<circle cx="50" cy="50" r="32" fill="none" stroke="url(#grad-${Math.abs(hash)})" stroke-width="8" />
              <circle cx="50" cy="50" r="14" fill="url(#grad-${Math.abs(hash)})" />`;
  }

  return `
    <defs>
      <linearGradient id="grad-${Math.abs(hash)}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color1}" />
        <stop offset="100%" stop-color="${color2}" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="#161c28" />
    ${shapes}
  `;
}

function updateAvatarSvg(svgElement, seed) {
  if (svgElement) {
    svgElement.innerHTML = getSvgAvatarMarkup(seed);
  }
}

// ─── Active User Session Handlers ────────────────────────────────────────────────
function initLocalStorageSession() {
  const userId = localStorage.getItem('userId');
  const sessionId = localStorage.getItem('sessionId');
  const ipAddress = localStorage.getItem('ipAddress');
  const deviceType = localStorage.getItem('deviceType');

  if (userId && sessionId) {
    userSession = { userId, sessionId, ipAddress, deviceType };
    renderProfileWidget(true);
    // Auto fill player submission field
    document.getElementById('submit-player-id').value = userId;
  } else {
    renderProfileWidget(false);
  }
}

function renderProfileWidget(isLoggedIn) {
  const guestView = document.getElementById('guest-widget-view');
  const profileView = document.getElementById('profile-widget-view');
  
  if (isLoggedIn) {
    guestView.classList.add('hidden');
    profileView.classList.remove('hidden');
    document.getElementById('my-profile-name').textContent = userSession.userId;
    document.getElementById('my-profile-meta').textContent = `${userSession.deviceType.toUpperCase()} | ${userSession.ipAddress}`;
    
    // Set custom avatar
    const svgEl = profileView.querySelector('.avatar-svg');
    updateAvatarSvg(svgEl, userSession.userId);
  } else {
    guestView.classList.remove('hidden');
    profileView.classList.add('hidden');
  }
}

function openLoginModal() {
  document.getElementById('login-modal').classList.remove('hidden');
  document.getElementById('sess-modal-feedback').classList.add('hidden');
}

function closeLoginModal() {
  document.getElementById('login-modal').classList.add('hidden');
}

async function handleCreateSession() {
  const userIdInput = document.getElementById('sess-user-id').value.trim();
  const ipInput = document.getElementById('sess-ip').value.trim();
  const deviceSelect = document.getElementById('sess-device').value;
  const feedback = document.getElementById('sess-modal-feedback');

  if (!userIdInput || !ipInput) {
    showFeedback(feedback, 'Please fill in all fields', 'error');
    return;
  }

  try {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userIdInput,
        ipAddress: ipInput,
        deviceType: deviceSelect
      })
    });

    const data = await response.json();

    if (response.status === 201) {
      userSession = {
        userId: userIdInput,
        sessionId: data.sessionId,
        ipAddress: ipInput,
        deviceType: deviceSelect
      };

      localStorage.setItem('userId', userIdInput);
      localStorage.setItem('sessionId', data.sessionId);
      localStorage.setItem('ipAddress', ipInput);
      localStorage.setItem('deviceType', deviceSelect);

      renderProfileWidget(true);
      document.getElementById('submit-player-id').value = userIdInput;
      closeLoginModal();
      
      // Auto-trigger admin lookup for convenience
      document.getElementById('admin-user-id').value = userIdInput;
      handleAdminLookup();
    } else {
      showFeedback(feedback, data.error || 'Failed to create session', 'error');
    }
  } catch (err) {
    showFeedback(feedback, 'Network error. Make sure server is running.', 'error');
  }
}

async function logoutSession() {
  if (!userSession.sessionId) return;
  try {
    await fetch(`/api/admin/sessions/${userSession.sessionId}`, { method: 'DELETE' });
  } catch (err) {
    console.error('Logout error clearing session on backend:', err);
  }
  
  localStorage.clear();
  userSession = { userId: null, sessionId: null, ipAddress: null, deviceType: null };
  renderProfileWidget(false);
  document.getElementById('submit-player-id').value = '';
}

// ─── Fetch and Render Leaderboard ───────────────────────────────────────────────
async function fetchLeaderboard() {
  try {
    const limitEl = document.getElementById('leaderboard-limit');
    const limit = limitEl ? limitEl.value : 10;
    localStorage.setItem('leaderboardLimit', limit);
    const response = await fetch(`/api/leaderboard/top/${limit}`);
    const players = await response.json();

    const podium1 = document.getElementById('card-rank-1');
    const podium2 = document.getElementById('card-rank-2');
    const podium3 = document.getElementById('card-rank-3');
    const tbody = document.getElementById('leaderboard-rows');

    // Fill Podium structure
    const p1 = players[0] || { playerId: 'No Champion', score: 0 };
    const p2 = players[1] || { playerId: 'Challenger 2', score: 0 };
    const p3 = players[2] || { playerId: 'Challenger 3', score: 0 };

    // Update Champion card (1st)
    podium1.querySelector('.podium-name').textContent = p1.playerId;
    podium1.querySelector('.stat-value').textContent = p1.score;
    updateAvatarSvg(podium1.querySelector('.podium-avatar svg'), p1.playerId);

    // Update 2nd card
    podium2.querySelector('.podium-name').textContent = p2.playerId;
    podium2.querySelector('.stat-value').textContent = p2.score;
    updateAvatarSvg(podium2.querySelector('.podium-avatar svg'), p2.playerId);

    // Update 3rd card
    podium3.querySelector('.podium-name').textContent = p3.playerId;
    podium3.querySelector('.stat-value').textContent = p3.score;
    updateAvatarSvg(podium3.querySelector('.podium-avatar svg'), p3.playerId);

    // Render table rows (Ranks 4-10, or all if less than 3)
    tbody.innerHTML = '';
    
    if (players.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center">No active players on the leaderboard. Be the first!</td></tr>`;
      return;
    }

    players.forEach((player) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="rank-column text-cyan">${player.rank}</td>
        <td>
          <div class="player-column">
            <div class="player-avatar">
              <svg width="32" height="32" viewBox="0 0 100 100">${getSvgAvatarMarkup(player.playerId)}</svg>
            </div>
            <span class="player-name">${player.playerId}</span>
          </div>
        </td>
        <td class="score-column text-right">${player.score}</td>
        <td class="text-right">
          <button class="btn-small-lookup" onclick="lookupSpecificPlayer('${player.playerId}')"><i class="fa-solid fa-search"></i> Stats</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error fetching leaderboard:', err);
  }
}

// ─── Quiz Rounds Countdown Timers ────────────────────────────────────────────────
function startRoundTimer(endTimeString, durationMs) {
  if (activeRoundTimer) clearInterval(activeRoundTimer);
  
  currentRoundEndTime = new Date(endTimeString).getTime();
  currentRoundDuration = Number(durationMs);

  // Enable submission inputs
  document.getElementById('btn-submit-answer').disabled = false;
  document.getElementById('active-round-hint-text').classList.add('hidden');

  updateTimerUI();
  activeRoundTimer = setInterval(updateTimerUI, 200);
}

function updateTimerUI() {
  const now = Date.now();
  const remainingMs = currentRoundEndTime - now;

  const timerCountdown = document.getElementById('timer-countdown-val');
  const timerFill = document.getElementById('timer-progress-fill');
  
  if (remainingMs <= 0) {
    clearInterval(activeRoundTimer);
    timerCountdown.textContent = '00:00';
    timerFill.style.width = '0%';
    document.getElementById('current-active-round').textContent = 'None Active (Round Closed)';
    document.getElementById('btn-submit-answer').disabled = true;
    document.getElementById('active-round-hint-text').classList.remove('hidden');
    document.getElementById('active-round-hint-text').textContent = 'Submissions closed for the previous round.';
    
    // Clear active round from local storage
    localStorage.removeItem('activeRoundText');
    localStorage.removeItem('activeRoundEndTime');
    localStorage.removeItem('activeRoundDuration');
    return;
  }

  // Format MM:SS
  const secondsTotal = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(secondsTotal / 60);
  const seconds = secondsTotal % 60;
  const timeFormatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  timerCountdown.textContent = timeFormatted;

  // Progress Bar
  const pct = Math.max(0, Math.min(100, (remainingMs / currentRoundDuration) * 100));
  timerFill.style.width = `${pct}%`;
}

// ─── Event Handlers for Forms & API Requests ─────────────────────────────────────

// 1. Submit Answer
async function handleSubmitAnswer() {
  const playerId = document.getElementById('submit-player-id').value.trim();
  const answer = document.getElementById('submit-answer').value.trim();
  const feedback = document.getElementById('submit-feedback');

  // Parse active round details
  const activeRoundText = document.getElementById('current-active-round').textContent;
  if (!activeRoundText || activeRoundText.includes('None Active')) {
    showFeedback(feedback, 'No active round to submit to!', 'error');
    return;
  }

  // Extract gameId and roundId from "game_round:gameId:roundId"
  const match = activeRoundText.match(/game_round:([^:]+):(.+)/);
  if (!match) {
    showFeedback(feedback, 'Unable to identify active game/round indices.', 'error');
    return;
  }
  const gameId = match[1];
  const roundId = match[2];

  if (!playerId || !answer) {
    showFeedback(feedback, 'Player ID and Answer are required', 'error');
    return;
  }

  try {
    const response = await fetch('/api/game/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, roundId, playerId, answer })
    });
    
    const data = await response.json();
    
    if (response.status === 200) {
      showFeedback(feedback, `SUCCESS! Score updated: ${data.newScore} pts`, 'success');
      document.getElementById('submit-answer').value = '';
      fetchLeaderboard();
    } else {
      showFeedback(feedback, `ERROR: ${data.code || 'Submission failed'}`, 'error');
    }
  } catch (err) {
    showFeedback(feedback, 'Submission failed. Server connection error.', 'error');
  }
}

// 2. Seed round (Admin)
async function handleSeedRound() {
  const gameId = document.getElementById('seed-game-id').value.trim();
  const roundId = document.getElementById('seed-round-id').value.trim();
  const correctAnswer = document.getElementById('seed-correct').value.trim();
  const points = document.getElementById('seed-points').value;
  const durationSec = document.getElementById('seed-duration').value;
  const feedback = document.getElementById('seed-feedback');

  if (!gameId || !roundId || !correctAnswer || !points || !durationSec) {
    showFeedback(feedback, 'Please fill in all seed parameters', 'error');
    return;
  }

  try {
    const response = await fetch('/api/game/rounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId,
        roundId,
        correctAnswer,
        points: Number(points),
        durationMs: Number(durationSec) * 1000
      })
    });

    const data = await response.json();

    if (response.status === 201) {
      showFeedback(feedback, 'New quiz round seeded successfully!', 'success');
      document.getElementById('seed-round-id').value = '';
      document.getElementById('seed-correct').value = '';
    } else {
      showFeedback(feedback, data.error || 'Seeding failed', 'error');
    }
  } catch (err) {
    showFeedback(feedback, 'Failed to connect. Server error.', 'error');
  }
}

// 2b. Increment Score
async function handleIncrementScore() {
  const playerId = document.getElementById('inc-player-id').value.trim();
  const points = document.getElementById('inc-points').value;
  const feedback = document.getElementById('inc-feedback');

  if (!playerId || !points) {
    showFeedback(feedback, 'Player ID and Points are required', 'error');
    return;
  }

  try {
    const response = await fetch('/api/leaderboard/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, points: Number(points) })
    });
    
    const data = await response.json();
    
    if (response.status === 200) {
      showFeedback(feedback, `Success! ${playerId}'s score is now ${data.newScore}`, 'success');
      document.getElementById('inc-points').value = 10;
      fetchLeaderboard();
    } else {
      showFeedback(feedback, data.error || 'Failed to increment score', 'error');
    }
  } catch (err) {
    showFeedback(feedback, 'Increment score failed. Connection error.', 'error');
  }
}

// 3. Stats Lookup
async function handlePlayerLookup() {
  const playerId = document.getElementById('lookup-player-id').value.trim();
  if (!playerId) return;
  await lookupSpecificPlayer(playerId);
}

async function lookupSpecificPlayer(playerId) {
  // Sync search field
  document.getElementById('lookup-player-id').value = playerId;
  
  const results = document.getElementById('lookup-results');
  try {
    const response = await fetch(`/api/leaderboard/player/${playerId}`);
    if (response.status !== 200) {
      results.classList.add('hidden');
      alert(`Player "${playerId}" not found on the leaderboard yet.`);
      return;
    }

    const data = await response.json();
    results.classList.remove('hidden');

    // Save searched playerId to restore on refresh
    localStorage.setItem('lastSearchedPlayerId', playerId);

    document.getElementById('res-rank').textContent = data.rank;
    document.getElementById('res-score').textContent = data.score;
    document.getElementById('res-percentile').textContent = `${data.percentile}%`;

    // Render competition ring (Above)
    const abovePanel = document.getElementById('res-nearby-above');
    abovePanel.innerHTML = '';
    if (data.nearbyPlayers.above && data.nearbyPlayers.above.length > 0) {
      data.nearbyPlayers.above.reverse().forEach(p => {
        abovePanel.innerHTML += `
          <div class="nearby-player-row">
            <span>#${p.rank} ${p.playerId}</span>
            <span>${p.score}</span>
          </div>
        `;
      });
    } else {
      abovePanel.innerHTML = '<div class="nearby-player-row italic" style="font-size:10px">Top of leaderboard</div>';
    }

    // Render current player row in Ring
    document.getElementById('res-nearby-current').innerHTML = `
      <span>#${data.rank} ${data.playerId}</span>
      <span>${data.score}</span>
    `;

    // Render below
    const belowPanel = document.getElementById('res-nearby-below');
    belowPanel.innerHTML = '';
    if (data.nearbyPlayers.below && data.nearbyPlayers.below.length > 0) {
      data.nearbyPlayers.below.forEach(p => {
        belowPanel.innerHTML += `
          <div class="nearby-player-row">
            <span>#${p.rank} ${p.playerId}</span>
            <span>${p.score}</span>
          </div>
        `;
      });
    } else {
      belowPanel.innerHTML = '<div class="nearby-player-row italic" style="font-size:10px">Bottom of leaderboard</div>';
    }

  } catch (err) {
    console.error('Lookup stats error:', err);
    results.classList.add('hidden');
  }
}

// 4. Admin Session Lookup & Terminate
async function handleAdminLookup() {
  const userId = document.getElementById('admin-user-id').value.trim();
  const listPanel = document.getElementById('admin-sessions-result');
  
  if (!userId) {
    listPanel.innerHTML = '<div class="list-placeholder">Enter a user ID to search</div>';
    return;
  }

  // Save admin searched user ID
  localStorage.setItem('lastSearchedAdminUserId', userId);

  try {
    const response = await fetch(`/api/admin/sessions/user/${userId}`);
    const sessions = await response.json();

    listPanel.innerHTML = '';
    if (sessions.length === 0) {
      listPanel.innerHTML = '<div class="list-placeholder text-gold">No active sessions found for this user</div>';
      return;
    }

    sessions.forEach(sess => {
      const item = document.createElement('div');
      item.className = 'admin-session-item';
      item.innerHTML = `
        <div class="admin-session-row">
          <span class="sid-lbl">Session ID:</span>
          <span>${sess.sessionId.substring(0, 8)}...</span>
        </div>
        <div class="admin-session-row">
          <span>IP:</span>
          <span>${sess.ipAddress}</span>
        </div>
        <div class="admin-session-row">
          <span>Device:</span>
          <span>${sess.deviceType.toUpperCase()}</span>
        </div>
        <div class="admin-session-row">
          <span>Last Active:</span>
          <span>${new Date(sess.lastActive).toLocaleTimeString()}</span>
        </div>
        <div class="admin-session-row actions">
          <button class="btn-small-danger" onclick="revokeSession('${sess.sessionId}', '${userId}')">Revoke Session</button>
        </div>
      `;
      listPanel.appendChild(item);
    });

  } catch (err) {
    listPanel.innerHTML = '<div class="list-placeholder text-gold">Error retrieving session data</div>';
  }
}

async function revokeSession(sessionId, userId) {
  if (!confirm(`Are you sure you want to terminate session ${sessionId}?`)) return;

  try {
    const response = await fetch(`/api/admin/sessions/${sessionId}`, { method: 'DELETE' });
    if (response.status === 204) {
      // If we revoked our own active session, clear it locally
      if (userSession.sessionId === sessionId) {
        logoutSession();
      }
      
      // Refresh admin sessions list
      handleAdminLookup();
    }
  } catch (err) {
    alert('Failed to delete session. Server error.');
  }
}

// Helper: Show alert feedbacks
function showFeedback(element, text, type) {
  element.textContent = text;
  element.className = `action-feedback ${type}`;
  element.classList.remove('hidden');
  
  // Auto dismiss success actions
  if (type === 'success') {
    setTimeout(() => {
      element.classList.add('hidden');
    }, 4000);
  }
}

// ─── Server-Sent Events Subscriber Pipeline ───────────────────────────────────────
function initServerSentEvents() {
  const eventsFeed = document.getElementById('events-feed');
  const eventSource = new EventSource('/api/events');

  eventSource.onopen = () => {
    document.getElementById('active-players-count').textContent = 'SSE Stream Connected';
    document.getElementById('active-players-count').style.color = '#10b981';
  };

  eventSource.onerror = () => {
    document.getElementById('active-players-count').textContent = 'Stream Offline';
    document.getElementById('active-players-count').style.color = '#ef4444';
  };

  // Setup generic message handler to log to the activities feed
  eventSource.onmessage = (e) => {
    // SSE streams send comments or message strings, format appropriately
    console.log('SSE message received:', e.data);
  };

  // Add listener for specific event types
  const attachEventListener = (eventType, handler) => {
    eventSource.addEventListener(eventType, (e) => {
      try {
        const data = JSON.parse(e.data);
        logEventToFeed(eventType, data);
        handler(data);
      } catch (err) {
        console.error(`Error parsing SSE event data for ${eventType}:`, err);
      }
    });
  };

  // 1. Leaderboard score updates
  attachEventListener('leaderboard_updated', (data) => {
    fetchLeaderboard();
    // If we have lookup results currently showing for this player, refresh them
    const lookupPlayerField = document.getElementById('lookup-player-id').value.trim();
    if (lookupPlayerField === data.playerId) {
      lookupSpecificPlayer(data.playerId);
    }
  });

  // 2. Quiz round seeded events
  attachEventListener('round_started', (data) => {
    const roundText = `game_round:${data.gameId}:${data.roundId}`;
    document.getElementById('current-active-round').textContent = roundText;
    
    const duration = new Date(data.endTime).getTime() - Date.now();

    // Persist active round state to survive refresh
    localStorage.setItem('activeRoundText', roundText);
    localStorage.setItem('activeRoundEndTime', String(new Date(data.endTime).getTime()));
    localStorage.setItem('activeRoundDuration', String(duration));

    startRoundTimer(data.endTime, duration);
  });

  // 3. User session login/creation
  attachEventListener('session_created', (data) => {
    // Refresh admin details if that user is currently looked up
    const adminUser = document.getElementById('admin-user-id').value.trim();
    if (adminUser === data.userId) {
      handleAdminLookup();
    }
  });

  // 4. Session deletion/revocation
  attachEventListener('session_deleted', (data) => {
    // If our active session was revoked, log out
    if (userSession.sessionId === data.sessionId) {
      logoutSession();
      alert('Your session was terminated or invalidated.');
    }
    
    // Refresh admin sessions list
    const adminUser = document.getElementById('admin-user-id').value.trim();
    if (adminUser === data.userId) {
      handleAdminLookup();
    }
  });
}

function logEventToFeed(type, data) {
  const feed = document.getElementById('events-feed');
  const placeholder = feed.querySelector('.feed-placeholder');
  if (placeholder) placeholder.remove();

  const item = document.createElement('div');
  item.className = `feed-item ${type}`;

  const timeStr = new Date().toLocaleTimeString();
  let message = '';

  switch (type) {
    case 'leaderboard_updated':
      message = `🏆 Player <b>${data.playerId}</b> scored! Score: <b>${data.newScore}</b>`;
      break;
    case 'round_started':
      message = `🎯 Quiz Round <b>${data.roundId}</b> started! Ends at ${new Date(data.endTime).toLocaleTimeString()}`;
      break;
    case 'session_created':
      message = `🟢 User <b>${data.userId}</b> logged in via <b>${data.deviceType.toUpperCase()}</b>`;
      break;
    case 'session_deleted':
      message = `🔴 Session <b>${data.sessionId.substring(0, 8)}...</b> for user <b>${data.userId}</b> invalidated`;
      break;
    default:
      message = `Event: ${type}`;
  }

  item.innerHTML = `
    <span class="event-text">${message}</span>
    <span class="time">${timeStr}</span>
  `;

  feed.appendChild(item);
  feed.scrollTop = feed.scrollHeight;

  // Persist feed item to local storage
  try {
    const storedLogs = JSON.parse(localStorage.getItem('live_logs') || '[]');
    storedLogs.push({ type, message, timeStr });
    if (storedLogs.length > 50) {
      storedLogs.shift();
    }
    localStorage.setItem('live_logs', JSON.stringify(storedLogs));
  } catch (err) {
    console.error('Error saving log to localStorage:', err);
  }
}

function resumeStateFromLocalStorage() {
  // 1. Resume logs feed
  const feed = document.getElementById('events-feed');
  try {
    const storedLogs = JSON.parse(localStorage.getItem('live_logs') || '[]');
    if (storedLogs.length > 0) {
      const placeholder = feed.querySelector('.feed-placeholder');
      if (placeholder) placeholder.remove();
      storedLogs.forEach(log => {
        const item = document.createElement('div');
        item.className = `feed-item ${log.type}`;
        item.innerHTML = `
          <span class="event-text">${log.message}</span>
          <span class="time">${log.timeStr}</span>
        `;
        feed.appendChild(item);
      });
      feed.scrollTop = feed.scrollHeight;
    }
  } catch (err) {
    console.error('Error loading logs from localStorage:', err);
  }

  // 2. Resume Stats Lookup
  const lastPlayer = localStorage.getItem('lastSearchedPlayerId');
  if (lastPlayer) {
    lookupSpecificPlayer(lastPlayer);
  }

  // 3. Resume Admin Sessions Lookup
  const lastAdminUser = localStorage.getItem('lastSearchedAdminUserId');
  if (lastAdminUser) {
    document.getElementById('admin-user-id').value = lastAdminUser;
    handleAdminLookup();
  }

  // 4. Resume Active Round Timer
  const activeRoundText = localStorage.getItem('activeRoundText');
  const activeRoundEndTime = localStorage.getItem('activeRoundEndTime');
  const activeRoundDuration = localStorage.getItem('activeRoundDuration');

  if (activeRoundText && activeRoundEndTime && activeRoundDuration) {
    const endTime = Number(activeRoundEndTime);
    const now = Date.now();
    if (endTime > now) {
      document.getElementById('current-active-round').textContent = activeRoundText;
      startRoundTimer(new Date(endTime).toISOString(), Number(activeRoundDuration));
    } else {
      localStorage.removeItem('activeRoundText');
      localStorage.removeItem('activeRoundEndTime');
      localStorage.removeItem('activeRoundDuration');
    }
  }

  // 5. Resume Leaderboard Limit
  const storedLimit = localStorage.getItem('leaderboardLimit');
  if (storedLimit && document.getElementById('leaderboard-limit')) {
    document.getElementById('leaderboard-limit').value = storedLimit;
  }
}

// ─── Startup Hook Initialization ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initLocalStorageSession();
  fetchLeaderboard();
  initServerSentEvents();
  resumeStateFromLocalStorage();

  // Attach button triggers
  document.getElementById('btn-create-session-submit').addEventListener('click', handleCreateSession);
  document.getElementById('btn-submit-answer').addEventListener('click', handleSubmitAnswer);
  document.getElementById('btn-seed-round').addEventListener('click', handleSeedRound);
  document.getElementById('btn-increment-score').addEventListener('click', handleIncrementScore);
  document.getElementById('btn-lookup-player').addEventListener('click', handlePlayerLookup);
  document.getElementById('admin-lookup-btn').addEventListener('click', handleAdminLookup);

  // Attach Top N selector trigger
  const limitEl = document.getElementById('leaderboard-limit');
  if (limitEl) {
    limitEl.addEventListener('change', fetchLeaderboard);
  }
});

// Bind window methods for dynamic inline call handlers
window.revokeSession = revokeSession;
window.lookupSpecificPlayer = lookupSpecificPlayer;
window.logoutSession = logoutSession;
window.openLoginModal = openLoginModal;
window.closeLoginModal = closeLoginModal;

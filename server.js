"use strict";

require('dotenv').config();
const express = require('express');
const http = require('http');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');

const ebsSecret = process.env.EBS_SECRET;
const decodedSecret = Buffer.from(ebsSecret, 'base64');
const app = express();

/**
 * Client Id is static for extensions
 * @type {string}
 */
const clientId = '92ydmhd13dzrhhp087hyxqu3jks7f6';

app.use((req, res, next) => {
  console.log('Got request', req.path, req.method);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return next();
});

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// A list of broadcasters with connected viewers
const state = {
  broadCasters: [],
};

function generateJwt(userId, channelId) {
  const currentTime = new Date().getTime() / 1000;
  const expirationTime = 60 * 60 * 24 * 2; // 2 days
  const exp = Math.floor(currentTime + expirationTime);

  const token = {
    "exp": exp,
    "user_id": userId.toString(),
    "role": "external",
    "channel_id": channelId.toString(),
    "pubsub_perms": {
      "send": ["*"]
    }
  };

  return jwt.sign(token, decodedSecret);
}

async function dispatchBroadcasterGameState(channelId, gameState) {
  const signedJwt = generateJwt(channelId, channelId);
  let response = null;
  console.log("dispatching game state", gameState, channelId);
  await axios({
    method: 'post',
    url: `https://api.twitch.tv/extensions/message/${channelId}`,
    data: {
      "content_type": "application/json",
      "message": JSON.stringify(gameState),
      "targets": ["broadcast"]
    },
    headers: {
      'Authorization': `Bearer ${signedJwt}`,
      'Client-Id': clientId,
      'Content-Type': 'application/json'
    }
  }).then(() => {
    response = {
      success: true,
    };
  }).catch(err => {
    response = {
      success: false,
      error: err,
    };
  });
  return response;
}

// Registers a broadcaster
app.post('/hello', (req, res) => {
  console.log("got hello request", req.body);
  if (!req.body || !req.body.token) {
    return res.json({
      success: false,
      error: 'No valid request body provided.',
    });
  }

  const payload = jwt.verify(req.body.token, decodedSecret);
  if (payload.role !== 'broadcaster') {
    return res.json({
      success: false,
      error: 'Not a broadcaster token',
    });
  }

  const channelId = payload.channel_id;

  let broadCaster = state.broadCasters.find(bc => bc.id === channelId);
  if (!broadCaster) {
    broadCaster = {
      id: channelId,
      gameState: {},
      viewers: [],
    };

    state.broadCasters.push(broadCaster);
  }

  // Set talents
  if (req.body.talents) {
    broadCaster.gameState.talents = req.body.talents;
  }

  // Set visibility of talents
  if (req.body.displayingTalents !== undefined) {
    broadCaster.gameState.displayingTalents = req.body.displayingTalents;
  }

  if (req.body.chosenTalents !== undefined) {
    broadCaster.gameState.chosenTalents = req.body.chosenTalents;
  }

  // Dispatch if state was updated
  if (req.body.talents || req.body.displayingTalents !== undefined) {
    dispatchBroadcasterGameState(
      broadCaster.id,
      broadCaster.gameState,
    ).then(response => res.json(response))
      .catch(err => res.json({
          success: false,
          error: err,
        })
      );
  }
  else {
    return res.json({
      success: true,
    });
  }
});

// Register viewer
app.post('/register-viewer', (req, res) => {
  console.log("registering viewer", req.body);
  // Validate request
  if (!req.body || !req.body.token || !req.body.userId || !req.body.channelId) {
    return res.json({
      success: false,
      error: 'Missing required data',
    });
  }

  // Verify that their info is correct
  const payload = jwt.verify(req.body.token, decodedSecret);
  if (!(payload.user_id !== req.body.userId || payload.channel_id !== req.body.channelId)) {
    return res.json({
      success: false,
      error: 'Token payload and post data mismatch',
    });
  }

  // Register with broadcaster
  const broadcaster = state.broadCasters.find(bc => bc.id === req.body.channelId);
  if (broadcaster) {
    // Register with broadcaster
    const viewer = broadcaster.viewers.find(viewer => viewer === req.body.userId);
    if (!viewer) {
      broadcaster.viewers.push(req.body.userId);
    }

    return res.json({
      success: true,
      'gameState': broadcaster.gameState,
    });
  }
  else {
    return res.json({
      success: false,
      error: 'Invalid broadcaster',
    })
  }
});

// De-register a broadcaster
app.post('/byebye', (req, res) => {
  console.log("removing broadcaster gameState", req.body);
  if (!req.body || !req.body.token) {
    return res.json({
      success: false,
    });
  }

  // Verify token
  const payload = jwt.verify(req.body.token, decodedSecret);
  if (!payload || !payload.channel_id || payload.role !== 'broadcaster') {
    return res.json({
      success: false,
      error: 'Invalid termination token',
    });
  }
  const broadcasterId = payload.channel_id;

  const broadCaster = state.broadCasters
    .findIndex(bc => bc.id === broadcasterId);

  if (broadCaster !== -1) {
    // Remove twitch extension overlay for viewers
    dispatchBroadcasterGameState(broadcasterId, {
      displayingTalents: false,
      talents: [],
    }).then(response => {
      console.log("successfully stopped broadcasting talents for id", broadcasterId);
      return res.json(response)
    }).catch(err => {
        console.log("failed stopping broadcast", err);
        return res.json({
            success: false,
            error: err,
          })
        }
      );
    state.broadCasters = state.broadCasters.splice(broadCaster);
  }
  else {
    return res.json({
      success: false,
      error: 'No broadcaster found with that id',
    })
  }
});

// A simple get page for testing domains
app.get('/status', (req, res) => {
  return res.json({
    success: true
  });
});

app.use('/dist', express.static('dist'));

const APP_PORT = process.env.PORT || 3000;
http.createServer(app).listen(APP_PORT, function () {
  console.log('Dota Illuminate service running on http', APP_PORT);
});
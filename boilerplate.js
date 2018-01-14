"use strict";
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const https = require('https');
const http = require('http');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');

const ebsSecret = process.env.EBS_SECRET;
const app = express();

// TODO: Fix hardcoded values
const userId = 19733510;
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

const gameState = {
  talents: null,
  displayingTalents: false
};

app.post('/hello', (req, res) => {
  if (req.body) {
    // Game started, enable talents overlay
    if (req.body.talents) {
      // Store talents for later
      console.log("we got talents ?", req.body.talents);
      gameState.talents = req.body.talents;
    }

    if (req.body.displayingTalents !== undefined) {
      // Determines if talents should be shown
      console.log("we are ingame, display talents on mouseover ?", req.body.displayingTalents);
      gameState.displayingTalents = req.body.displayingTalents;
    }
  }

  return res.json({
    success: true,
  });
});

const currentTime = new Date().getTime() / 1000;
const expirationTime = 60 * 60 * 24 * 7; // A week
const exp = Math.floor(currentTime + expirationTime);

const token = {
  "exp": exp,
  "user_id": userId.toString(), // TODO: Receive from broadcaster
  "role": "external",
  "channel_id": userId.toString(),
  "pubsub_perms": {
    "send": ["*"]
  }
};

// Must base64 decode secret because jsonwebtoken module is retarded
const decodedSecret = Buffer.from(ebsSecret, 'base64');
const signedJwt = jwt.sign(token, decodedSecret);
let count = 0;

// Every interval send updated gamestate to viewers
setInterval(() => {
  console.log("sending message to pubsub, nr:", count);
  axios({
    method: 'post',
    url: `https://api.twitch.tv/extensions/message/${userId}`,
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
  }).then((res) => {
    // console.log("response ?", res);
    console.log("got response with status", res.status);
  }).catch(err => {
    console.log("got error ?", err);
  });

  count++;
}, 5000);

const PORT = 8080;
if (process.env.CERT_PATH) {
  let options = {
    key: fs.readFileSync(`${process.env.CERT_PATH}.key`),
    cert: fs.readFileSync(`${process.env.CERT_PATH}.crt`),
    rejectUnauthorized: false
  };

  https.createServer(options, app).listen(PORT, function () {
    console.log('Extension Boilerplate service running on https', PORT);
  });
}
else {
  const PORT = 8080;
  http.createServer(app).listen(PORT, function () {
    console.log('Extension Boilerplate service running on http', PORT);
  });
}
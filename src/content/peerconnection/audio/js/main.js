/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* global TimelineDataSeries, TimelineGraphView */

'use strict';

const audio2 = document.querySelector('audio#audio2');
const callButton = document.querySelector('button#callButton');
const hangupButton = document.querySelector('button#hangupButton');
const codecSelector = document.querySelector('select#codec');
hangupButton.disabled = true;
callButton.onclick = call;
hangupButton.onclick = hangup;

let pc1;
let pc2;
let localStream;

let bitrateGraph;
let bitrateSeries;

let packetGraph;
let packetSeries;

let lastResult;

const offerOptions = {
  offerToReceiveAudio: 1,
  offerToReceiveVideo: 0,
  voiceActivityDetection: false
};

function gotStream(stream) {
  hangupButton.disabled = false;
  console.log('Received local stream');
  localStream = stream;
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length > 0) {
    console.log(`Using Audio device: ${audioTracks[0].label}`);
  }
  localStream.getTracks().forEach(track => pc1.addTrack(track, localStream));
  console.log('Adding Local Stream to peer connection');

  pc1.createOffer(offerOptions)
    .then(gotDescription1, onCreateSessionDescriptionError);

  bitrateSeries = new TimelineDataSeries();
  bitrateGraph = new TimelineGraphView('bitrateGraph', 'bitrateCanvas');
  bitrateGraph.updateEndDate();

  packetSeries = new TimelineDataSeries();
  packetGraph = new TimelineGraphView('packetGraph', 'packetCanvas');
  packetGraph.updateEndDate();
}

function onCreateSessionDescriptionError(error) {
  console.log(`Failed to create session description: ${error.toString()}`);
}

function call() {
  callButton.disabled = true;
  codecSelector.disabled = true;
  console.log('Starting call');
  const servers = null;
  pc1 = new RTCPeerConnection(servers);
  console.log('Created local peer connection object pc1');
  pc1.onicecandidate = e => onIceCandidate(pc1, e);
  pc2 = new RTCPeerConnection(servers);
  console.log('Created remote peer connection object pc2');
  pc2.onicecandidate = e => onIceCandidate(pc2, e);
  pc2.ontrack = gotRemoteStream;
  console.log('Requesting local stream');
  navigator.mediaDevices
    .getUserMedia({
      audio: true,
      video: false
    })
    .then(gotStream)
    .catch(e => {
      alert(`getUserMedia() error: ${e.name}`);
    });
}

function gotDescription1(desc) {
  console.log(`Offer from pc1\n${desc.sdp}`);
  pc1.setLocalDescription(desc)
    .then(() => {
      desc.sdp = forceChosenAudioCodec(desc.sdp);
      pc2.setRemoteDescription(desc).then(() => {
        return pc2.createAnswer().then(gotDescription2, onCreateSessionDescriptionError);
      }, onSetSessionDescriptionError);
    }, onSetSessionDescriptionError);
}

function gotDescription2(desc) {
  console.log(`Answer from pc2\n${desc.sdp}`);
  pc2.setLocalDescription(desc).then(() => {
    desc.sdp = forceChosenAudioCodec(desc.sdp);
    pc1.setRemoteDescription(desc).then(() => {}, onSetSessionDescriptionError);
  }, onSetSessionDescriptionError);
}

function hangup() {
  console.log('Ending call');
  localStream.getTracks().forEach(track => track.stop());
  pc1.close();
  pc2.close();
  pc1 = null;
  pc2 = null;
  hangupButton.disabled = true;
  callButton.disabled = false;
  codecSelector.disabled = false;
}

function gotRemoteStream(e) {
  const range_elem = document.getElementById("range");
  const stereo_pan_elem = document.getElementById("stereo_pan");
  const pan_elem = document.getElementById("pan");

  if (audio2.srcObject !== e.streams[0]) {
    const remoteStream = e.streams[0]
    audio2.srcObject = remoteStream;
    console.log('Received remote stream');

  let context;
  // cope with browser differences
  if (typeof AudioContext === 'function') {
    context = new AudioContext();
  } else if (typeof webkitAudioContext === 'function') {
    context = new webkitAudioContext(); // eslint-disable-line new-cap
  } else {
    alert('Sorry! Web Audio is not supported by this browser');
  }

  console.log("HERE")

  // AudioSourceNode
  const audioSourceNode = context.createMediaStreamSource(remoteStream);
  
  // Filter
  const filter = context.createBiquadFilter();
  filter.type = "lowshelf";
  filter.frequency.value = 1000;
  filter.gain.value = range_elem.value;

  // StereoPanner
  const stereo_panner = context.createStereoPanner();
  stereo_panner.pan.value = 0

  // Generic Panner
  const panner = context.createPanner();
  panner.setPosition(100, 0, 0);

  // Connect the pipes
  audioSourceNode
    .connect(filter)
    .connect(stereo_panner)
    .connect(panner)
    .connect(context.destination);

  // User input
  range_elem.oninput = function() {
    filter.gain.value = range_elem.value;
  }

  stereo_pan_elem.oninput = function () {
    // console.log(x.value, y.value, z.value)
    // panner.setPosition(x.value, y.value, z.value)
    stereo_panner.pan.value = stereo_pan_elem.value;
    console.log(stereo_panner.pan.value);
  }

  pan_elem.oninput = function () {
    // Assume x = 100, but y in [-100, 100]
    panner.setPosition(100, pan_elem.value, 0)
    console.log(pan_elem.value)
  }

  }
}

function getOtherPc(pc) {
  return (pc === pc1) ? pc2 : pc1;
}

function getName(pc) {
  return (pc === pc1) ? 'pc1' : 'pc2';
}

function onIceCandidate(pc, event) {
  getOtherPc(pc).addIceCandidate(event.candidate)
    .then(
      () => onAddIceCandidateSuccess(pc),
      err => onAddIceCandidateError(pc, err)
    );
  console.log(`${getName(pc)} ICE candidate:\n${event.candidate ? event.candidate.candidate : '(null)'}`);
}

function onAddIceCandidateSuccess() {
  console.log('AddIceCandidate success.');
}

function onAddIceCandidateError(error) {
  console.log(`Failed to add ICE Candidate: ${error.toString()}`);
}

function onSetSessionDescriptionError(error) {
  console.log(`Failed to set session description: ${error.toString()}`);
}

function forceChosenAudioCodec(sdp) {
  return maybePreferCodec(sdp, 'audio', 'send', codecSelector.value);
}

// Copied from AppRTC's sdputils.js:

// Sets |codec| as the default |type| codec if it's present.
// The format of |codec| is 'NAME/RATE', e.g. 'opus/48000'.
function maybePreferCodec(sdp, type, dir, codec) {
  const str = `${type} ${dir} codec`;
  if (codec === '') {
    console.log(`No preference on ${str}.`);
    return sdp;
  }

  console.log(`Prefer ${str}: ${codec}`);

  const sdpLines = sdp.split('\r\n');

  // Search for m line.
  const mLineIndex = findLine(sdpLines, 'm=', type);
  if (mLineIndex === null) {
    return sdp;
  }

  // If the codec is available, set it as the default in m line.
  const codecIndex = findLine(sdpLines, 'a=rtpmap', codec);
  console.log('codecIndex', codecIndex);
  if (codecIndex) {
    const payload = getCodecPayloadType(sdpLines[codecIndex]);
    if (payload) {
      sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex], payload);
    }
  }

  sdp = sdpLines.join('\r\n');
  return sdp;
}

// Find the line in sdpLines that starts with |prefix|, and, if specified,
// contains |substr| (case-insensitive search).
function findLine(sdpLines, prefix, substr) {
  return findLineInRange(sdpLines, 0, -1, prefix, substr);
}

// Find the line in sdpLines[startLine...endLine - 1] that starts with |prefix|
// and, if specified, contains |substr| (case-insensitive search).
function findLineInRange(sdpLines, startLine, endLine, prefix, substr) {
  const realEndLine = endLine !== -1 ? endLine : sdpLines.length;
  for (let i = startLine; i < realEndLine; ++i) {
    if (sdpLines[i].indexOf(prefix) === 0) {
      if (!substr ||
        sdpLines[i].toLowerCase().indexOf(substr.toLowerCase()) !== -1) {
        return i;
      }
    }
  }
  return null;
}

// Gets the codec payload type from an a=rtpmap:X line.
function getCodecPayloadType(sdpLine) {
  const pattern = new RegExp('a=rtpmap:(\\d+) \\w+\\/\\d+');
  const result = sdpLine.match(pattern);
  return (result && result.length === 2) ? result[1] : null;
}

// Returns a new m= line with the specified codec as the first one.
function setDefaultCodec(mLine, payload) {
  const elements = mLine.split(' ');

  // Just copy the first three parameters; codec order starts on fourth.
  const newLine = elements.slice(0, 3);

  // Put target payload first and copy in the rest.
  newLine.push(payload);
  for (let i = 3; i < elements.length; i++) {
    if (elements[i] !== payload) {
      newLine.push(elements[i]);
    }
  }
  return newLine.join(' ');
}

// query getStats every second
window.setInterval(() => {
  if (!pc1) {
    return;
  }
  const sender = pc1.getSenders()[0];
  sender.getStats().then(res => {
    res.forEach(report => {
      let bytes;
      let packets;
      const now = report.timestamp;
      if (report.type === 'outbound-rtp') {
        bytes = report.bytesSent;
        packets = report.packetsSent;
        if (lastResult && lastResult.has(report.id)) {
          // calculate bitrate
          const bitrate = 8 * (bytes - lastResult.get(report.id).bytesSent) /
            (now - lastResult.get(report.id).timestamp);

          // append to chart
          bitrateSeries.addPoint(now, bitrate);
          bitrateGraph.setDataSeries([bitrateSeries]);
          bitrateGraph.updateEndDate();

          // calculate number of packets and append to chart
          packetSeries.addPoint(now, packets -
            lastResult.get(report.id).packetsSent);
          packetGraph.setDataSeries([packetSeries]);
          packetGraph.updateEndDate();
        }
      }
    });
    lastResult = res;
  });
}, 1000);

// Party

function Party() {
  const that = this;
  const seatConfig = SeatConfig();
}

Party.prototype.addMember = function(callback) {

}

Party.prototype.removeMember = function(callback) {

}

Party.prototype.shuffle = function(callback) {

}

// SeatConfig

function SeatConfig() {
  MIN_RADIUS = 1
  MAX_RADIUS = 10

  this.seats = [];
  // eventually change this to an enum
  this.shape = 1;

  // [MIN_RADIUS, MAX_RADIUS]
  this.radius = MIN_RADIUS
  // [0, 100]
  this.intimacy = 100

  const that = this;
}

SeatConfig.prototype.setIntimacy = function(intimacy) {
  if (intimacy >= 0 && intimacy <= 100) {
    that.intimacy = intimacy;
  }
}

SeatConfig.prototype.getRadius = function() {
  // this code currently only works for circles
  // 100 intimacy = min_radius
  // 0 intimacy = max_radius
  that.radius = (100-that.intimacy)/100*(MAX_RADIUS-MIN_RADIUS)+MIN_RADIUS
}

SeatConfig.prototype.addSeat = function(seat) {
  this.seats.push(seat);
}
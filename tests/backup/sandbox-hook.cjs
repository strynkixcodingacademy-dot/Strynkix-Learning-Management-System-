/**
 * Test-only observer for the export CLI (loaded with `node --require`).
 * Appends one JSON line to $SANDBOX_LOG for every Firebase/Google Cloud module
 * that is loaded and every outbound socket connection or DNS lookup, so the
 * emulator rehearsal can prove what each CLI mode touches. It never blocks.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Module = require('module');
const fs = require('fs');
const net = require('net');
const dns = require('dns');

const logFile = process.env.SANDBOX_LOG;
const log = (entry) => { if (logFile) fs.appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, ...entry })}\n`); };

const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (/^(firebase-admin|@google-cloud\/|firebase(\/|$)|@firebase\/|google-gax|@grpc\/)/.test(request)) log({ type: 'module', request });
  return originalLoad.call(this, request, ...rest);
};

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === 'object') {
    log(first.path ? { type: 'connect', host: `ipc:${first.path}`, port: null } : { type: 'connect', host: String(first.host ?? 'localhost'), port: Number(first.port) });
  } else {
    log({ type: 'connect', host: typeof args[1] === 'string' ? args[1] : 'localhost', port: Number(first) });
  }
  return originalConnect.apply(this, args);
};

const originalLookup = dns.lookup;
dns.lookup = function lookup(hostname, ...rest) {
  log({ type: 'dns', host: String(hostname) });
  return originalLookup.call(this, hostname, ...rest);
};

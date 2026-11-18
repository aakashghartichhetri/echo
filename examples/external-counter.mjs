#!/usr/bin/env node
/**
 * Example external black-box target using only Node's built-in HTTP server.
 * It could be replaced by a wrapper around a real unknown executable.
 */
import { createServer } from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.EXAMPLE_PORT ?? 3999);

createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.method !== 'POST' || request.url !== '/trace') {
    response.writeHead(404).end(JSON.stringify({ error: 'Use POST /trace' }));
    return;
  }
  try {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 2000) throw new Error('Request is too large');
    }
    const { actions } = JSON.parse(body);
    if (!Array.isArray(actions) || actions.length > 12 || actions.some((a) => !['push', 'pop'].includes(a))) {
      response.writeHead(400).end(JSON.stringify({ error: 'actions must contain push/pop only (maximum 12)' }));
      return;
    }
    let level = 0;
    const outputs = actions.map((action) => {
      if (action === 'push') {
        if (level === 2) return 'full';
        level += 1;
        return 'pushed';
      }
      if (level === 0) return 'empty';
      level -= 1;
      return 'popped';
    });
    response.end(JSON.stringify({ outputs }));
  } catch {
    response.writeHead(400).end(JSON.stringify({ error: 'Invalid JSON trace request' }));
  }
}).listen(port, host, () => console.log(`Example trace target: http://${host}:${port}/trace`));

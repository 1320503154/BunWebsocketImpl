// server.js
import { Database } from 'bun:sqlite';
import { serve } from 'bun';
import { join } from 'path';

// Initialize database
const db = new Database('chat.sqlite');
db.run(`CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT,
  receiver TEXT,
  content TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Store active connections
const activeConnections = new Map();

const server:any = serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    
    // Handle WebSocket upgrade request
    if (url.pathname === '/chat') {
      const username = url.searchParams.get('username');
      if (!username) {
        return new Response('Username is required', { status: 400 });
      }
      
      const success = server.upgrade(req, { data: { username } });
      return success
        ? undefined
        : new Response('WebSocket upgrade failed', { status: 500 });
    }
    
    // Handle image upload
    if (url.pathname === '/upload' && req.method === 'POST') {
      const formData = await req.formData();
      const file = formData.get('image');
      if (file instanceof File) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const filename = `${Date.now()}-${file.name}`;
        await Bun.write(join(import.meta.dir, 'uploads', filename), buffer);
        return new Response(JSON.stringify({ filename }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('No file uploaded', { status: 400 });
    }

    // Handle static file requests
    if (url.pathname.startsWith('/uploads/')) {
      const filePath = join(import.meta.dir, url.pathname);
      const file = Bun.file(filePath);
      return new Response(file);
    }

    // Serve the frontend
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const file = Bun.file(join(import.meta.dir, 'index.html'));
      return new Response(file);
    }

    return new Response('Not found', { status: 404 });
  },
  websocket: {
    open(ws) {
      const { username } = ws.data;
      console.log(`${username} connected`);
      activeConnections.set(username, ws);
      broadcastMessage(server, `${username} joined the chat`);
    },
    message(ws, message) {
      const { username } = ws.data;
      const data = JSON.parse(message);
      
      if (data.type === 'chat') {
        if (data.receiver) {
          // Private message
          sendPrivateMessage(username, data.receiver, data.content);
        } else {
          // Public message
          broadcastMessage(server, `${username}: ${data.content}`);
        }
        // Save message to database
        db.run('INSERT INTO messages (sender, receiver, content) VALUES (?, ?, ?)', 
          [username, data.receiver || null, data.content]);
      } else if (data.type === 'image') {
        // Handle image message
        const imageUrl = `/uploads/${data.filename}`;
        if (data.receiver) {
          sendPrivateMessage(username, data.receiver, `[Image] ${imageUrl}`);
        } else {
          broadcastMessage(server, `${username} sent an image: [Image] ${imageUrl}`);
        }
        // Save image message to database
        db.run('INSERT INTO messages (sender, receiver, content) VALUES (?, ?, ?)', 
          [username, data.receiver || null, `[Image] ${imageUrl}`]);
      } else if (data.type === 'get_history') {
        // New type to handle history request
        sendMessageHistory(username, data.receiver);
      }
    },
    close(ws) {
      const { username } = ws.data;
      console.log(`${username} disconnected`);
      activeConnections.delete(username);
      broadcastMessage(server, `${username} left the chat`);
    },
  },
});

function broadcastMessage(server, message) {
  for (const ws of activeConnections.values()) {
    ws.send(JSON.stringify({
      type: 'chat',
      content: message
    }));
  }
}

function sendPrivateMessage(sender, receiver, content) {
  const receiverWs = activeConnections.get(receiver);
  if (receiverWs) {
    receiverWs.send(JSON.stringify({
      type: 'private',
      sender,
      content
    }));
  }
  // Also send to the sender
  const senderWs = activeConnections.get(sender);
  if (senderWs) {
    senderWs.send(JSON.stringify({
      type: 'private',
      receiver,
      content
    }));
  }
}

function sendMessageHistory(username, receiver) {

  const ws = activeConnections.get(username);
  if (ws) {
    console.log('In index.ts receiver::: ', receiver);
    console.log('In index.ts username::: ', username);
    const messages = db.prepare(`
      SELECT * FROM messages 
      WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?)
      ORDER BY timestamp ASC
      LIMIT 100
    `).all(username, receiver, receiver, username);
    
    ws.send(JSON.stringify({
      type: 'history',
      messages
    }));
  }
}

console.log(`Server running on http://localhost:${server.port}`);
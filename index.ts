// server.js
const server = Bun.serve({
  port: 3000,
  fetch(req, server) {
    // 升级HTTP请求到WebSocket连接
    if (server.upgrade(req)) {
      return; // 升级成功,不需要返回响应
    }
    return new Response("Upgrade failed", { status: 500 });
  },
  websocket: {
    open(ws) {
      console.log("WebSocket连接已打开");
      ws.subscribe("chatroom");
      server.publish("chatroom", "新用户加入聊天室!");
    },
    message(ws, message) {
      console.log(`收到消息: ${message}`);
      // 将消息广播给所有订阅者
      server.publish("chatroom", `用户说: ${message}`);
    },
    close(ws, code, message) {
      console.log(`WebSocket连接已关闭: ${code} - ${message}`);
      ws.unsubscribe("chatroom");
      server.publish("chatroom", "有用户离开了聊天室");
    },
  },
});

console.log(`WebSocket服务器运行在 ws://localhost:${server.port}`);
const { Server } = require('socket.io');
const store = require('./store');

let io = null;

function initSocket(httpServer, sessionMiddleware) {
  io = new Server(httpServer);

  // 기존 express-session을 그대로 소켓 핸드셰이크에도 적용해 별도 인증 없이 재사용한다.
  io.use((socket, next) => sessionMiddleware(socket.request, {}, next));
  io.use((socket, next) => {
    if (socket.request.session && socket.request.session.user) return next();
    next(new Error('unauthorized'));
  });

  io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('join-event', ({ eventId } = {}) => {
      if (!eventId || !store.getEvent(eventId)) return;
      if (currentRoom) socket.leave(currentRoom);
      currentRoom = `event:${eventId}`;
      socket.join(currentRoom);
    });

    socket.on('leave-event', () => {
      if (currentRoom) {
        socket.leave(currentRoom);
        currentRoom = null;
      }
    });
  });

  return io;
}

// 서버(REST 라우트)가 store를 갱신한 뒤 호출 — 소켓은 클라이언트로부터 직접
// 상태 변경을 받지 않고, 항상 REST 처리 결과를 브로드캐스트만 한다.
function broadcastToEvent(eventId, event, payload) {
  if (!io) return;
  io.to(`event:${eventId}`).emit(event, payload);
}

module.exports = { initSocket, broadcastToEvent };

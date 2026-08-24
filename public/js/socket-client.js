// Socket.IO 연결 + 이벤트(행사) room 참여를 감싸는 얇은 래퍼.
// 서버가 세션 쿠키로 인증하므로 별도 토큰 처리는 필요 없다.
window.SocketClient = {
  connect(eventId, { onAlertCreated, onAlertResolved, onInstallUpdated, onConnect } = {}) {
    const socket = io();

    socket.on('connect', () => {
      socket.emit('join-event', { eventId });
      if (onConnect) onConnect();
    });

    if (onAlertCreated) socket.on('alert:created', onAlertCreated);
    if (onAlertResolved) socket.on('alert:resolved', onAlertResolved);
    if (onInstallUpdated) socket.on('booths:install-updated', onInstallUpdated);

    return socket;
  },

  switchEvent(socket, eventId) {
    socket.emit('join-event', { eventId });
  },
};

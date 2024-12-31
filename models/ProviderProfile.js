const mongoose = require('mongoose');

const providerProfileSchema = new mongoose.Schema({
    providerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    specialization: { type: String, required: true },
    licenseNumber: { type: String, required: true },
    phone: { type: String, required: true },
    officeAddress: { type: String, required: true },
    medicalSchool: { type: String, required: true },
    profileCompleted: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Update the updatedAt timestamp before saving
providerProfileSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('ProviderProfile', providerProfileSchema); 
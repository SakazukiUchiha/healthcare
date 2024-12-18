const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, required: true, enum: ['patient', 'clinic-staff', 'healthcare-provider'] },
    // Provider profile fields
    firstName: { type: String },
    lastName: { type: String },
    specialization: { type: String },
    licenseNumber: { type: String },
    phone: { type: String },
    officeAddress: { type: String },
    medicalSchool: { type: String },
    graduationYear: { type: String },
    boardCertifications: { type: String },
    profileCompleted: { type: Boolean, default: false }
});

module.exports = mongoose.model('User', userSchema);

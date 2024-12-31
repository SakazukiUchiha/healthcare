const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
    appointmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Appointment',
        required: true
    },
    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    doctorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    patientName: { type: String, required: true },
    doctorName: { type: String, required: true },
    appointmentType: { type: String, required: true },
    appointmentDate: { type: Date, required: true },
    status: { type: String, required: true },
    bookedBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Report', reportSchema); 
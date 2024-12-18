const mongoose = require('mongoose');

const medicalRecordSchema = new mongoose.Schema({
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
    date: {
        type: Date,
        default: Date.now
    },
    recordType: {
        type: String,
        required: true
    },
    diagnosis: {
        type: String,
        required: true
    },
    prescription: String,
    notes: String
});

module.exports = mongoose.model('MedicalRecord', medicalRecordSchema); 
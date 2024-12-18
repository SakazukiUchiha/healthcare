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
    recordType: {
        type: String,
        required: true
    },
    diagnosis: {
        type: String,
        required: true
    },
    prescription: {
        type: String
    },
    notes: {
        type: String
    },
    date: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['active', 'archived'],
        default: 'active'
    }
});

module.exports = mongoose.model('MedicalRecord', medicalRecordSchema); 
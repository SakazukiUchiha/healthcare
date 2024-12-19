const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
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
    dateTime: { 
        type: Date, 
        required: true 
    },
    type: { 
        type: String, 
        required: true 
    },
    status: { 
        type: String, 
        enum: ['scheduled', 'accepted', 'cancelled', 'completed'],
        default: 'scheduled'
    },
    reminderSent: {
        type: Boolean,
        default: false
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('Appointment', appointmentSchema); 
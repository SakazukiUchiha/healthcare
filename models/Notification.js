const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: ['appointment_cancelled', 'appointment_accepted', 'appointment_reminder', 'appointment_completed', 'new_appointment']
    },
    message: {
        type: String,
        required: true
    },
    read: {
        type: Boolean,
        default: false
    },
    date: {
        type: Date,
        default: Date.now
    },
    appointmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Appointment'
    }
});

module.exports = mongoose.model('Notification', notificationSchema); 
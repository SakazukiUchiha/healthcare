const mongoose = require('mongoose');

const providerScheduleSchema = new mongoose.Schema({
    providerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    workingHours: {
        start: {
            type: String,
            required: true,
            default: '09:00'
        },
        end: {
            type: String,
            required: true,
            default: '17:00'
        }
    },
    breakTime: {
        start: {
            type: String,
            required: true,
            default: '13:00'
        },
        end: {
            type: String,
            required: true,
            default: '14:00'
        }
    }
});

module.exports = mongoose.model('ProviderSchedule', providerScheduleSchema); 
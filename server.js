const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Appointment = require('./models/Appointment');
const MedicalRecord = require('./models/MedicalRecord');
const ProviderProfile = require('./models/ProviderProfile');
const PatientProfile = require('./models/PatientProfile');
const Notification = require('./models/Notification');
const ProviderSchedule = require('./models/ProviderSchedule');
const Report = require('./models/Report');
const app = express();

// Define PORT first
const PORT = process.env.PORT || 3034;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// MongoDB Connection
mongoose.connect('mongodb://127.0.0.1:27017/healthcare', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
})
.then(() => {
    console.log('Connected to MongoDB successfully');
    // Only start the server after successful DB connection
    app.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
    });

    // Function to check for upcoming appointments and send reminders
    async function checkUpcomingAppointments() {
        try {
            // Get current time
            const now = new Date();
            // Get appointments in the next hour
            const endTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now

            const upcomingAppointments = await Appointment.find({
                dateTime: { $gt: now, $lte: endTime },
                status: 'accepted',
                reminderSent: { $ne: true } // Only send reminder once
            }).populate('patientId', 'username')
              .populate('doctorId', 'username');

            for (const appointment of upcomingAppointments) {
                const appointmentTime = new Date(appointment.dateTime);
                const timeDiff = appointmentTime.getTime() - now.getTime();
                const minutesDiff = Math.floor(timeDiff / (1000 * 60));

                // Send reminder if appointment is within 30-60 minutes
                if (minutesDiff <= 60 && minutesDiff >= 30) {
                    // Create notification for patient
                    const patientNotification = new Notification({
                        userId: appointment.patientId._id,
                        type: 'appointment_reminder',
                        message: `Reminder: You have an appointment with Dr. ${appointment.doctorId.username} at ${appointmentTime.toLocaleTimeString()}`,
                        appointmentId: appointment._id
                    });
                    await patientNotification.save();

                    // Create notification for provider
                    const providerNotification = new Notification({
                        userId: appointment.doctorId._id,
                        type: 'appointment_reminder',
                        message: `Reminder: You have an appointment with ${appointment.patientId.username} at ${appointmentTime.toLocaleTimeString()}`,
                        appointmentId: appointment._id
                    });
                    await providerNotification.save();

                    // Mark appointment as reminder sent
                    appointment.reminderSent = true;
                    await appointment.save();
                }
            }
        } catch (error) {
            console.error('Error checking upcoming appointments:', error);
        }
    }

    // Set up interval to check for upcoming appointments every minute
    setInterval(checkUpcomingAppointments, 60000); // Check every minute
})
.catch(err => {
    console.error('Failed to connect to MongoDB. Error:', err);
    process.exit(1); // Exit the process with failure
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// User Registration
app.post('/register', async (req, res) => {
    try {
        const { username, email, password, role } = req.body;
        
        // Check if user exists
        const userExists = await User.findOne({ $or: [{ email }, { username }] });
        if (userExists) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const user = new User({
            username,
            email,
            password: hashedPassword,
            role
        });

        await user.save();
        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// User Login
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Find user
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Determine dashboard based on role
        let dashboard;
        switch(user.role) {
            case 'patient':
                dashboard = '/Pdashboard.html';
                break;
            case 'healthcare-provider':
                dashboard = '/Hdashboard.html';
                break;
            default:
                return res.status(400).json({ message: 'Invalid role' });
        }

        res.json({ 
            redirect: dashboard,
            role: user.role,
            username: user.username,
            userId: user._id
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Get available doctors
app.get('/api/doctors', async (req, res) => {
    try {
        const doctors = await User.find({ role: 'healthcare-provider' })
            .select('username _id');
        res.json(doctors);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching doctors' });
    }
});

// Create new appointment
app.post('/api/appointments', async (req, res) => {
    try {
        const { patientId, doctorId, dateTime, type } = req.body;

        // Get provider's schedule
        const schedule = await ProviderSchedule.findOne({ providerId: doctorId });
        if (!schedule) {
            return res.status(400).json({ message: 'Provider schedule not found' });
        }

        // Convert appointment time to HH:mm format for comparison
        const appointmentTime = new Date(dateTime);
        const timeString = appointmentTime.getHours().toString().padStart(2, '0') + ':' + 
                          appointmentTime.getMinutes().toString().padStart(2, '0');

        // Check if appointment is within working hours
        if (timeString < schedule.workingHours.start || timeString >= schedule.workingHours.end) {
            return res.status(400).json({ message: 'Appointment time is outside working hours' });
        }

        // Check if appointment is during break time
        if (timeString >= schedule.breakTime.start && timeString < schedule.breakTime.end) {
            return res.status(400).json({ message: 'Appointment time is during break time' });
        }

        // Check for existing appointment at the same time
        const startTime = new Date(appointmentTime);
        const endTime = new Date(appointmentTime);
        endTime.setHours(endTime.getHours() + 1); // Assuming 1-hour appointments

        const existingAppointment = await Appointment.findOne({
            doctorId,
            dateTime: {
                $gte: startTime,
                $lt: endTime
            },
            status: { $in: ['scheduled', 'accepted'] }
        });

        if (existingAppointment) {
            return res.status(400).json({ message: 'This time slot is already booked' });
        }

        const appointment = new Appointment({
            patientId,
            doctorId,
            dateTime: appointmentTime,
            type,
            status: 'scheduled'
        });

        const savedAppointment = await appointment.save();

        // Create notification for the provider
        const notification = new Notification({
            userId: doctorId,
            type: 'new_appointment',
            message: `New appointment booked for ${type} on ${appointmentTime.toLocaleDateString()} at ${appointmentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            appointmentId: savedAppointment._id
        });

        await notification.save();

        res.status(201).json({ 
            message: 'Appointment created successfully',
            appointmentId: savedAppointment._id 
        });
    } catch (error) {
        console.error('Error creating appointment:', error);
        res.status(500).json({ message: 'Error creating appointment', error: error.message });
    }
});

// Get patient's appointments
app.get('/api/appointments/:patientId', async (req, res) => {
    try {
        // Get current date at the start of the day
        const currentDate = new Date();
        currentDate.setHours(0, 0, 0, 0);

        const appointments = await Appointment.find({ 
            patientId: req.params.patientId,
            status: 'scheduled',
            dateTime: { $gte: currentDate } // Only get upcoming appointments
        })
        .populate('doctorId', 'username')
        .sort({ dateTime: 1 });

        // Format the appointments for the frontend
        const formattedAppointments = appointments.map(apt => ({
            _id: apt._id,
            doctorId: apt.doctorId,
            dateTime: apt.dateTime,
            type: apt.type,
            status: apt.status
        }));

        res.json(formattedAppointments);
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ message: 'Error fetching appointments' });
    }
});

// Cancel appointment
app.delete('/api/appointments/:appointmentId', async (req, res) => {
    try {
        const appointment = await Appointment.findById(req.params.appointmentId)
            .populate('patientId', 'username')
            .populate('doctorId', 'username');

        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found' });
        }

        // Update appointment status
        appointment.status = 'cancelled';
        await appointment.save();

        // Update the corresponding report status
        await Report.findOneAndUpdate(
            { appointmentId: appointment._id },
            { status: 'cancelled' }
        );

        // Get the user who initiated the cancellation from the request headers or query
        const cancelledBy = req.query.cancelledBy || req.headers['x-cancelled-by'];

        // Create appropriate notification based on who cancelled
        if (cancelledBy === 'provider') {
            // If provider cancelled, notify the patient
            const notification = new Notification({
                userId: appointment.patientId._id,
                type: 'appointment_cancelled',
                message: `Your appointment with Dr. ${appointment.doctorId.username} has been cancelled. Please book again at another time.`,
                appointmentId: appointment._id
            });
            await notification.save();
        } else if (cancelledBy === 'patient') {
            // If patient cancelled, notify the provider
            const notification = new Notification({
                userId: appointment.doctorId._id,
                type: 'appointment_cancelled',
                message: `Patient ${appointment.patientId.username} has cancelled their appointment scheduled for ${new Date(appointment.dateTime).toLocaleString()}.`,
                appointmentId: appointment._id
            });
            await notification.save();
        }

        res.json({ message: 'Appointment cancelled successfully' });
    } catch (error) {
        console.error('Error cancelling appointment:', error);
        res.status(500).json({ message: 'Error cancelling appointment' });
    }
});

// Get provider's appointments for a specific date
app.get('/api/appointments/provider/:providerId', async (req, res) => {
    try {
        const { providerId } = req.params;
        const { date } = req.query;

        // Create date range for the specified date (start of day to end of day)
        const startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);

        const appointments = await Appointment.find({ 
            doctorId: providerId,
            dateTime: { $gte: startDate, $lte: endDate },
            status: { $in: ['scheduled', 'accepted'] }
        })
        .populate('patientId', 'username') // Get patient details
        .sort({ dateTime: 1 });

        // Format the appointments for the frontend
        const formattedAppointments = appointments.map(apt => ({
            _id: apt._id,
            patientId: apt.patientId._id,
            patientName: apt.patientId.username,
            dateTime: apt.dateTime,
            reason: apt.type,
            status: apt.status
        }));

        res.json(formattedAppointments);
    } catch (error) {
        console.error('Error fetching provider appointments:', error);
        res.status(500).json({ message: 'Error fetching appointments' });
    }
});

// Medical Records Routes

// Create new medical record
app.post('/api/medical-records', async (req, res) => {
    try {
        const { patientId, doctorId, recordType, diagnosis, prescription, notes } = req.body;

        // Create the medical record
        const record = new MedicalRecord({
            patientId,
            doctorId,
            recordType,
            diagnosis,
            prescription,
            notes
        });

        await record.save();

        // Find and update the corresponding appointment
        const appointment = await Appointment.findOne({
            patientId,
            doctorId,
            status: 'accepted',
            type: recordType
        }).populate('doctorId', 'username');

        if (appointment) {
            // Mark appointment as completed
            appointment.status = 'completed';
            await appointment.save();

            // Update the corresponding report status
            await Report.findOneAndUpdate(
                { appointmentId: appointment._id },
                { status: 'completed' }
            );

            // Create notification for the patient
            const notification = new Notification({
                userId: patientId,
                type: 'appointment_completed',
                message: `Your appointment with Dr. ${appointment.doctorId.username} has been completed and a medical record has been created.`,
                appointmentId: appointment._id
            });

            await notification.save();
        }

        res.status(201).json({ 
            message: 'Medical record created successfully',
            appointmentUpdated: !!appointment
        });
    } catch (error) {
        console.error('Error creating medical record:', error);
        res.status(500).json({ message: 'Error creating medical record' });
    }
});

// Search medical records
app.get('/api/medical-records/search', async (req, res) => {
    try {
        const { query, doctorId } = req.query;
        
        // First, find patients whose names match the query
        let matchingPatients = [];
        if (query) {
            matchingPatients = await User.find({
                role: 'patient',
                username: { $regex: query, $options: 'i' }
            }).select('_id');
        }

        // Create search criteria
        let searchCriteria = { doctorId };
        if (query) {
            searchCriteria['$or'] = [
                { patientId: { $in: matchingPatients.map(p => p._id) } }, // Search by matching patient IDs
                { recordType: { $regex: query, $options: 'i' } },
                { diagnosis: { $regex: query, $options: 'i' } },
                { notes: { $regex: query, $options: 'i' } }
            ];
        }

        const records = await MedicalRecord.find(searchCriteria)
            .populate('patientId', 'username')
            .sort({ date: -1 });

        res.json(records);
    } catch (error) {
        console.error('Error searching medical records:', error);
        res.status(500).json({ message: 'Error searching medical records' });
    }
});

// Get medical record by ID
app.get('/api/medical-records/:recordId', async (req, res) => {
    try {
        const record = await MedicalRecord.findById(req.params.recordId)
            .populate('patientId', 'username')
            .populate('doctorId', 'username');

        if (!record) {
            return res.status(404).json({ message: 'Medical record not found' });
        }

        res.json(record);
    } catch (error) {
        console.error('Error fetching medical record:', error);
        res.status(500).json({ message: 'Error fetching medical record' });
    }
});

// Get patients list
app.get('/api/patients', async (req, res) => {
    try {
        const patients = await User.find({ role: 'patient' })
            .select('username _id');
        res.json(patients);
    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({ message: 'Error fetching patients' });
    }
});

// Get patients list with search
app.get('/api/patients/search', async (req, res) => {
    try {
        const { query } = req.query;
        const providerId = req.query.providerId; // Get the provider ID from query params

        // Get all appointments for this provider that are either scheduled or accepted
        const appointments = await Appointment.find({ 
            doctorId: providerId,
            status: { $in: ['scheduled', 'accepted'] }
        }).distinct('patientId'); // Get unique patient IDs

        // Build search criteria
        let searchCriteria = {
            role: 'patient',
            _id: { $in: appointments } // Only include patients who have appointments
        };
        
        if (query) {
            searchCriteria.username = { $regex: query, $options: 'i' };
        }

        const patients = await User.find(searchCriteria)
            .select('username email _id')
            .sort({ username: 1 });

        res.json(patients);
    } catch (error) {
        console.error('Error searching patients:', error);
        res.status(500).json({ message: 'Error searching patients' });
    }
});

// Add new patient
app.post('/api/patients', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // Check if patient exists
        const userExists = await User.findOne({ 
            $or: [{ email }, { username }],
            role: 'patient'
        });
        
        if (userExists) {
            return res.status(400).json({ message: 'Patient already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new patient
        const patient = new User({
            username,
            email,
            password: hashedPassword,
            role: 'patient'
        });

        await patient.save();
        res.status(201).json({ 
            message: 'Patient added successfully',
            patient: {
                _id: patient._id,
                username: patient.username,
                email: patient.email
            }
        });
    } catch (error) {
        console.error('Error adding patient:', error);
        res.status(500).json({ message: 'Error adding patient' });
    }
});

// Update medical record
app.put('/api/medical-records/:recordId', async (req, res) => {
    try {
        const { recordType, diagnosis, prescription, notes } = req.body;
        const record = await MedicalRecord.findByIdAndUpdate(
            req.params.recordId,
            {
                recordType,
                diagnosis,
                prescription,
                notes,
                date: Date.now() // Update the date when record is modified
            },
            { new: true }
        ).populate('patientId', 'username');

        if (!record) {
            return res.status(404).json({ message: 'Medical record not found' });
        }

        res.json(record);
    } catch (error) {
        console.error('Error updating medical record:', error);
        res.status(500).json({ message: 'Error updating medical record' });
    }
});

// Delete medical record
app.delete('/api/medical-records/:recordId', async (req, res) => {
    try {
        const record = await MedicalRecord.findByIdAndDelete(req.params.recordId);
        
        if (!record) {
            return res.status(404).json({ message: 'Medical record not found' });
        }

        res.json({ message: 'Medical record deleted successfully' });
    } catch (error) {
        console.error('Error deleting medical record:', error);
        res.status(500).json({ message: 'Error deleting medical record' });
    }
});

// Update provider profile
app.put('/api/provider-profile/:providerId', async (req, res) => {
    try {
        const { 
            firstName, 
            lastName, 
            specialization, 
            licenseNumber, 
            phone, 
            officeAddress,
            graduationYear,
            boardCertifications 
        } = req.body;

        // Check if provider exists in User model
        const provider = await User.findById(req.params.providerId);
        if (!provider || provider.role !== 'healthcare-provider') {
            return res.status(404).json({ message: 'Provider not found' });
        }

        // Find or create provider profile
        let providerProfile = await ProviderProfile.findOne({ providerId: req.params.providerId });
        
        if (providerProfile) {
            // Update existing profile
            providerProfile = await ProviderProfile.findOneAndUpdate(
                { providerId: req.params.providerId },
                {
                    firstName,
                    lastName,
                    specialization,
                    licenseNumber,
                    phone,
                    officeAddress,
                    graduationYear,
                    boardCertifications,
                    profileCompleted: true
                },
                { new: true }
            );
        } else {
            // Create new profile
            providerProfile = new ProviderProfile({
                providerId: req.params.providerId,
                firstName,
                lastName,
                specialization,
                licenseNumber,
                phone,
                officeAddress,
                graduationYear,
                boardCertifications,
                profileCompleted: true
            });
            await providerProfile.save();
        }

        res.json({
            message: 'Profile updated successfully',
            profile: {
                firstName: providerProfile.firstName,
                lastName: providerProfile.lastName,
                specialization: providerProfile.specialization
            }
        });
    } catch (error) {
        console.error('Error updating provider profile:', error);
        res.status(500).json({ message: 'Error updating profile' });
    }
});

// Get provider profile
app.get('/api/provider-profile/:providerId', async (req, res) => {
    try {
        const providerProfile = await ProviderProfile.findOne({ providerId: req.params.providerId });

        if (!providerProfile) {
            // If no profile exists yet, return empty values
            return res.json({
                firstName: '',
                lastName: '',
                specialization: '',
                licenseNumber: '',
                phone: '',
                officeAddress: '',
                graduationYear: '',
                boardCertifications: ''
            });
        }

        res.json(providerProfile);
    } catch (error) {
        console.error('Error fetching provider profile:', error);
        res.status(500).json({ message: 'Error fetching profile' });
    }
});

// Update patient profile
app.put('/api/patient-profile/:patientId', async (req, res) => {
    try {
        const { 
            firstName, 
            lastName, 
            dateOfBirth,
            gender,
            phone,
            address,
            emergencyContact,
            medicalHistory,
            insuranceInfo
        } = req.body;

        // Check if patient exists in User model
        const patient = await User.findById(req.params.patientId);
        if (!patient || patient.role !== 'patient') {
            return res.status(404).json({ message: 'Patient not found' });
        }

        // Find or create patient profile
        let patientProfile = await PatientProfile.findOne({ patientId: req.params.patientId });
        
        if (patientProfile) {
            // Update existing profile
            patientProfile = await PatientProfile.findOneAndUpdate(
                { patientId: req.params.patientId },
                {
                    firstName,
                    lastName,
                    dateOfBirth: new Date(dateOfBirth),
                    gender,
                    phone,
                    address,
                    emergencyContact,
                    medicalHistory,
                    insuranceInfo,
                    profileCompleted: true
                },
                { new: true }
            );
        } else {
            // Create new profile
            patientProfile = new PatientProfile({
                patientId: req.params.patientId,
                firstName,
                lastName,
                dateOfBirth: new Date(dateOfBirth),
                gender,
                phone,
                address,
                emergencyContact,
                medicalHistory,
                insuranceInfo,
                profileCompleted: true
            });
            await patientProfile.save();
        }

        res.json({
            message: 'Profile updated successfully',
            profile: patientProfile
        });
    } catch (error) {
        console.error('Error updating patient profile:', error);
        res.status(500).json({ message: 'Error updating profile' });
    }
});

// Get patient profile
app.get('/api/patient-profile/:patientId', async (req, res) => {
    try {
        const patientProfile = await PatientProfile.findOne({ patientId: req.params.patientId });

        if (!patientProfile) {
            // If no profile exists yet, return empty values
            return res.json({
                firstName: '',
                lastName: '',
                dateOfBirth: '',
                gender: '',
                phone: '',
                address: '',
                emergencyContact: {
                    name: '',
                    relationship: '',
                    phone: ''
                },
                medicalHistory: {
                    allergies: '',
                    chronicConditions: '',
                    currentMedications: '',
                    pastSurgeries: ''
                },
                insuranceInfo: {
                    provider: '',
                    policyNumber: '',
                    groupNumber: ''
                }
            });
        }

        res.json(patientProfile);
    } catch (error) {
        console.error('Error fetching patient profile:', error);
        res.status(500).json({ message: 'Error fetching profile' });
    }
});

// Get patient's medical records
app.get('/api/medical-records/patient/:patientId', async (req, res) => {
    try {
        const records = await MedicalRecord.find({ patientId: req.params.patientId })
            .populate('doctorId', 'username')
            .sort({ date: -1 });

        res.json(records);
    } catch (error) {
        console.error('Error fetching patient medical records:', error);
        res.status(500).json({ message: 'Error fetching medical records' });
    }
});

// Get provider's patients with their appointment types
app.get('/api/provider-patients/:providerId', async (req, res) => {
    try {
        const { providerId } = req.params;

        // Get all scheduled and accepted appointments for this provider
        const appointments = await Appointment.find({ 
            doctorId: providerId,
            status: { $in: ['scheduled', 'accepted'] }
        }).populate('patientId', 'username email');

        // Format the response to include patient details and appointment type
        const patients = appointments.map(apt => ({
            _id: apt.patientId._id,
            username: apt.patientId.username,
            email: apt.patientId.email,
            appointmentType: apt.type,
            status: apt.status
        }));

        // Remove duplicates (keep the latest appointment type for each patient)
        const uniquePatients = Array.from(
            patients.reduce((map, patient) => 
                map.set(patient._id.toString(), patient),
                new Map()
            ).values()
        );

        res.json(uniquePatients);
    } catch (error) {
        console.error('Error fetching provider patients:', error);
        res.status(500).json({ message: 'Error fetching patients' });
    }
});

// Create notification
app.post('/api/notifications', async (req, res) => {
    try {
        const { userId, type, message, appointmentId } = req.body;
        
        const notification = new Notification({
            userId,
            type,
            message,
            appointmentId
        });

        await notification.save();
        res.status(201).json({ message: 'Notification created successfully' });
    } catch (error) {
        console.error('Error creating notification:', error);
        res.status(500).json({ message: 'Error creating notification' });
    }
});

// Get user's notifications
app.get('/api/notifications/:userId', async (req, res) => {
    try {
        const notifications = await Notification.find({ userId: req.params.userId })
            .sort({ date: -1 })
            .limit(50); // Limit to last 50 notifications
        res.json(notifications);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ message: 'Error fetching notifications' });
    }
});

// Mark notification as read
app.put('/api/notifications/:notificationId/read', async (req, res) => {
    try {
        // Instead of updating, find and delete the notification
        const notification = await Notification.findByIdAndDelete(req.params.notificationId);

        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }

        res.json({ message: 'Notification deleted successfully' });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ message: 'Error deleting notification' });
    }
});

// Update the appointment accept endpoint
app.put('/api/appointments/:appointmentId/accept', async (req, res) => {
    try {
        // Find the appointment and populate patient and doctor details
        const appointment = await Appointment.findById(req.params.appointmentId)
            .populate('patientId', 'username')
            .populate('doctorId', 'username');

        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found' });
        }

        // Check if appointment is already accepted or cancelled
        if (appointment.status === 'accepted') {
            return res.status(400).json({ message: 'Appointment is already accepted' });
        }
        if (appointment.status === 'cancelled') {
            return res.status(400).json({ message: 'Cannot accept a cancelled appointment' });
        }

        // Update appointment status and reset reminder flag
        appointment.status = 'accepted';
        appointment.reminderSent = false; // Reset reminder flag when accepting appointment
        await appointment.save();

        // Update the corresponding report status
        await Report.findOneAndUpdate(
            { appointmentId: appointment._id },
            { status: 'accepted' }
        );

        // Create notification for the patient
        const notification = new Notification({
            userId: appointment.patientId._id,
            type: 'appointment_accepted',
            message: `Your appointment with Dr. ${appointment.doctorId.username} has been accepted.`,
            appointmentId: appointment._id
        });

        await notification.save();

        res.json({ 
            message: 'Appointment accepted successfully',
            appointment: {
                _id: appointment._id,
                patientName: appointment.patientId.username,
                dateTime: appointment.dateTime,
                type: appointment.type,
                status: appointment.status
            }
        });
    } catch (error) {
        console.error('Error accepting appointment:', error);
        res.status(500).json({ message: 'Error accepting appointment' });
    }
});

// Get provider's schedule
app.get('/api/provider-schedule/:providerId', async (req, res) => {
    try {
        let schedule = await ProviderSchedule.findOne({ providerId: req.params.providerId });
        
        if (!schedule) {
            // Return default schedule if none exists
            schedule = {
                workingHours: {
                    start: '09:00',
                    end: '17:00'
                },
                breakTime: {
                    start: '13:00',
                    end: '14:00'
                }
            };
        }
        
        res.json(schedule);
    } catch (error) {
        console.error('Error fetching provider schedule:', error);
        res.status(500).json({ message: 'Error fetching schedule' });
    }
});

// Update provider's schedule
app.post('/api/provider-schedule', async (req, res) => {
    try {
        const { providerId, workingHours, breakTime } = req.body;

        // Validate time format and ranges
        const validateTime = (time) => {
            const [hours] = time.split(':');
            return hours >= 0 && hours < 24;
        };

        if (!validateTime(workingHours.start) || !validateTime(workingHours.end) ||
            !validateTime(breakTime.start) || !validateTime(breakTime.end)) {
            return res.status(400).json({ message: 'Invalid time format' });
        }

        // Find or create schedule
        let schedule = await ProviderSchedule.findOne({ providerId });
        
        if (schedule) {
            schedule.workingHours = workingHours;
            schedule.breakTime = breakTime;
        } else {
            schedule = new ProviderSchedule({
                providerId,
                workingHours,
                breakTime
            });
        }

        await schedule.save();
        res.json({ message: 'Schedule updated successfully' });
    } catch (error) {
        console.error('Error updating provider schedule:', error);
        res.status(500).json({ message: 'Error updating schedule' });
    }
});

// Get reports with filters
app.get('/api/reports', async (req, res) => {
    try {
        const { dateRange, status, search } = req.query;
        let query = {};

        // Apply date range filter
        if (dateRange) {
            const now = new Date();
            let startDate = new Date();
            
            switch(dateRange) {
                case 'today':
                    startDate.setHours(0, 0, 0, 0);
                    break;
                case 'week':
                    startDate.setDate(now.getDate() - 7);
                    break;
                case 'month':
                    startDate.setMonth(now.getMonth() - 1);
                    break;
            }
            
            if (dateRange !== 'all') {
                query.appointmentDate = { $gte: startDate };
            }
        }

        // Apply status filter
        if (status && status !== 'all') {
            query.status = status;
        }

        // Apply search filter
        if (search) {
            query.$or = [
                { patientName: { $regex: search, $options: 'i' } },
                { doctorName: { $regex: search, $options: 'i' } },
                { appointmentType: { $regex: search, $options: 'i' } },
                { bookedBy: { $regex: search, $options: 'i' } }
            ];
        }

        console.log('Fetching reports with query:', query); // Add logging

        const reports = await Report.find(query)
            .sort({ appointmentDate: -1 });

        console.log('Found reports:', reports.length); // Add logging

        res.json(reports);
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({ message: 'Error fetching reports' });
    }
});

// Create new report
app.post('/api/reports', async (req, res) => {
    try {
        console.log('Received report data:', req.body);
        
        // Validate required fields
        const requiredFields = ['appointmentId', 'patientId', 'doctorId', 'patientName', 'doctorName', 'appointmentType', 'appointmentDate', 'status', 'bookedBy'];
        for (const field of requiredFields) {
            if (!req.body[field]) {
                return res.status(400).json({ message: `Missing required field: ${field}` });
            }
        }

        const report = new Report(req.body);
        const savedReport = await report.save();
        
        console.log('Report saved:', savedReport);
        
        res.status(201).json({ 
            message: 'Report created successfully',
            reportId: savedReport._id 
        });
    } catch (error) {
        console.error('Error creating report:', error);
        res.status(500).json({ message: 'Error creating report', error: error.message });
    }
});

// Add error handler
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

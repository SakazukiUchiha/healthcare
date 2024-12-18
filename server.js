const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Appointment = require('./models/Appointment');
const MedicalRecord = require('./models/MedicalRecord');
const ProviderProfile = require('./models/ProviderProfile');
const PatientProfile = require('./models/PatientProfile');
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

        // Check for existing appointment at the same time
        const appointmentDate = new Date(dateTime);
        const startTime = new Date(appointmentDate);
        const endTime = new Date(appointmentDate);
        endTime.setHours(endTime.getHours() + 1); // Assuming 1-hour appointments

        const existingAppointment = await Appointment.findOne({
            doctorId,
            dateTime: {
                $gte: startTime,
                $lt: endTime
            },
            status: 'scheduled'
        });

        if (existingAppointment) {
            return res.status(400).json({ message: 'This time slot is already booked' });
        }

        const appointment = new Appointment({
            patientId,
            doctorId,
            dateTime: appointmentDate,
            type
        });

        await appointment.save();
        res.status(201).json({ message: 'Appointment scheduled successfully' });
    } catch (error) {
        console.error('Error creating appointment:', error);
        res.status(500).json({ message: 'Error scheduling appointment' });
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
        const appointment = await Appointment.findByIdAndUpdate(
            req.params.appointmentId,
            { status: 'cancelled' },
            { new: true }
        );

        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found' });
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
            status: 'scheduled'
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

        const record = new MedicalRecord({
            patientId,
            doctorId,
            recordType,
            diagnosis,
            prescription,
            notes
        });

        await record.save();
        res.status(201).json({ message: 'Medical record created successfully' });
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
        let searchCriteria = { role: 'patient' };
        
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
            medicalSchool,
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
                    medicalSchool,
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
                medicalSchool,
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
                medicalSchool: '',
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

// Add error handler
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

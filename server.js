const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Appointment = require('./models/Appointment');
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
        const appointments = await Appointment.find({ 
            patientId: req.params.patientId,
            status: 'scheduled'
        })
        .populate('doctorId', 'username')
        .sort({ dateTime: 1 });

        res.json(appointments);
    } catch (error) {
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

// Add error handler
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

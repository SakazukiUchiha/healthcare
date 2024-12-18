const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
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
            username: user.username 
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Add error handler
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

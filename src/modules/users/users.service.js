const User = require('../../models/user.model');

module.exports.getUserById = async (userId) => {
    const user = await User.findById(userId).select('-password');
    if (!user) {
        throw new Error('User not found');
    }
    return user;
}

module.exports.getCurrentUser = async (userId) => {
    return await this.getUserById(userId);
}

module.exports.getUserList = async (page = 1, limit = 10) => {
    const skip = (page - 1) * limit;
    
    const users = await User.find().select('-password').skip(skip).limit(limit).sort({ createdAt: -1 });
    const total = await User.countDocuments();
    
    return {
        users,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

module.exports.updateUser = async (userId, updateData) => {
    const { name, email } = updateData;
    
    // Check if email is already used by another user
    if (email) {
        const existingUser = await User.findOne({ 
            email, 
            _id: { $ne: userId } 
        });
        if (existingUser) {
            throw new Error('Email already in use');
        }
    }
    
    // Prepare update data
    const updateFields = {};
    if (name) updateFields.name = name;
    if (email) updateFields.email = email;
    
    // Update user
    const user = await User.findByIdAndUpdate(
        userId,
        { $set: updateFields },
        { new: true, runValidators: true }
    ).select('-password');
    
    if (!user) {
        throw new Error('User not found');
    }
    
    return user;
}
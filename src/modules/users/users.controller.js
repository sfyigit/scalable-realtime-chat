const userService = require('./users.service');

module.exports.getUserList = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        
        const result = await userService.getUserList(page, limit);
        res.status(200).json({
            success: true,
            data: result.users,
            pagination: result.pagination
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

module.exports.getUserById = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await userService.getUserById(id);
        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        res.status(404).json({
            success: false,
            error: error.message
        });
    }
}

module.exports.updateUser = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { name, email } = req.body;
        
        // Validation
        if (!name && !email) {
            return res.status(400).json({
                success: false,
                error: 'At least one field (name or email) is required'
            });
        }
        
        const user = await userService.updateUser(userId, { name, email });
        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        const statusCode = error.message === 'Email already in use' ? 409 : 
                          error.message === 'User not found' ? 404 : 400;
        res.status(statusCode).json({
            success: false,
            error: error.message
        });
    }
}
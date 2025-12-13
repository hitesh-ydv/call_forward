import jwt from "jsonwebtoken";

export default function auth(req, res, next) {
    const token = req.cookies.adminToken;

    if (!token) return res.status(401).json({ message: "No auth" });

    try {
        jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        return res.status(403).json({ message: "Invalid token" });
    }
}

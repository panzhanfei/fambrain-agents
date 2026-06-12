import bcrypt from "bcryptjs";
const ROUNDS = 12;
export const hashPassword = async (plain: string): Promise<string> => {
    return bcrypt.hash(plain, ROUNDS);
};
export const verifyPassword = async (plain: string, hashed: string): Promise<boolean> => {
    return bcrypt.compare(plain, hashed);
};

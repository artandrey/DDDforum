import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import express, {
    NextFunction,
    RequestHandler,
    Request,
    Response,
} from 'express';
import db from './db';
import { eq, or } from 'drizzle-orm';
import cors from 'cors';

const app = express();

declare global {
    namespace Express {
        interface Response {
            success(data: unknown): void;
            error(error: ApiError): void;
        }
    }
}

class ApiError {
    constructor(public statusCode: number, public message: string) {}

    public static usernameAlreadyTaken() {
        return new ApiError(409, 'UsernameAlreadyTaken');
    }

    public static emailAlreadyInUse() {
        return new ApiError(409, 'EmailAlreadyInUse');
    }

    public static validationError() {
        return new ApiError(400, 'ValidationError');
    }

    public static serverError() {
        return new ApiError(500, 'ServerError');
    }

    public static userNotFound() {
        return new ApiError(404, 'UserNotFound');
    }
}

app.use(cors());

app.use(express.json());

const responseMiddleware = (): RequestHandler => (req, res, next) => {
    res.success = (data: unknown) => res.send({ data, success: true });
    res.error = (error: ApiError) =>
        res
            .status(error.statusCode)
            .send({ error: error.message, success: false });
    next();
};

const users = sqliteTable('users', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    email: text('email').unique().notNull(),
    username: text('username').unique().notNull(),
    firstName: text('firstName'),
    lastName: text('lastName'),
    password: text('password').notNull(),
});

app.use(responseMiddleware());

interface User {
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    password: string;
}

async function assertUserIsValid(user: User) {
    if (
        ![
            user.email,
            user.firstName,
            user.lastName,
            user.password,
            user.username,
        ].every(Boolean)
    ) {
        throw ApiError.validationError();
    }
    const [candidate] = await db
        .select()
        .from(users)
        .where(
            or(eq(users.email, user.email), eq(users.username, user.username))
        );

    if (!candidate) return;

    if (candidate.email === user.email) throw ApiError.emailAlreadyInUse();
    if (candidate.username === user.username)
        throw ApiError.usernameAlreadyTaken();
}

const userValidationMiddleware: RequestHandler = (req, res, next) => {
    try {
        assertUserIsValid(req.body);
    } catch (error) {
        next(error);
    }
};

app.post('/users/new', userValidationMiddleware, async (req, res) => {
    const { email, username, firstName, lastName, password } = req.body;
    const [result] = await db
        .insert(users)
        .values({ email, username, firstName, lastName, password })
        .returning({
            email: users.email,
            username: users.username,
            firstName: users.firstName,
            lastName: users.lastName,
        });
    if (!result) throw ApiError.userNotFound();
    res.success(result);
});

app.post('/users/edit/:userId', userValidationMiddleware, async (req, res) => {
    const { email, username, firstName, lastName, password } = req.body;
    const { userId } = req.params;
    const [result] = await db
        .update(users)
        .set({ email, username, firstName, lastName, password })
        .where(eq(users.id, +userId))
        .returning({
            email: users.email,
            username: users.username,
            firstName: users.firstName,
            lastName: users.lastName,
        });
    if (!result) throw ApiError.userNotFound();
    res.success(result);
});

app.get('/users', async (req, res) => {
    const { email } = req.query;
    if (!email) throw ApiError.validationError();
    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, String(email)));

    if (!user) {
        throw ApiError.userNotFound();
    }

    res.success(user);
});

app.use(
    (
        err: ApiError | unknown,
        _req: Request,
        res: Response,
        _next: NextFunction
    ) => {
        if (err instanceof ApiError) {
            res.error(err);
        } else {
            res.error(ApiError.serverError());
        }
    }
);

app.listen(3000, () => console.log('Running'));

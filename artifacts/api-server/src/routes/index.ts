import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import callsRouter from "./calls";
import botsRouter from "./bots";
import statsRouter from "./stats";
import configRouter from "./config";
import memoryRouter from "./memory";
import calendarRouter from "./calendar";
import messagingRouter from "./messaging";
import apiKeysRouter from "./api-keys";
import flowRouter from "./flow";
import emailAgentRouter from "./email-agent";
import personasRouter from "./personas";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(callsRouter);
router.use(botsRouter);
router.use(statsRouter);
router.use(configRouter);
router.use(memoryRouter);
router.use(calendarRouter);
router.use(messagingRouter);
router.use(apiKeysRouter);
router.use(flowRouter);
router.use(emailAgentRouter);
router.use(personasRouter);

export default router;

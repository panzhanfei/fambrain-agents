import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

type SpeechRecognitionCtor = new () => SpeechRecognition;

const getSpeechRecognitionCtor = (): SpeechRecognitionCtor | null => {
    if (typeof window === "undefined")
        return null;
    return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
};

const subscribeSpeechSupport = (): (() => void) => () => undefined;

const getSpeechSupportSnapshot = (): boolean => getSpeechRecognitionCtor() !== null;

const speechErrorMessage = (code: string): string | null => {
    switch (code) {
        case "aborted":
            return null;
        case "not-allowed":
            return "麦克风未授权：请在浏览器地址栏左侧点 🔒 → 网站设置 → 允许麦克风，然后刷新页面再试";
        case "service-not-allowed":
            return "当前页面非安全上下文或浏览器禁用了语音（请用 https 或 localhost 打开）";
        case "no-speech":
            return "未检测到语音，请靠近麦克风再试";
        case "network":
            return "语音识别需要联网（Chrome 会将音频发送到 Google 服务）";
        case "audio-capture":
            return "无法访问麦克风，请检查系统设置 → 隐私 → 麦克风";
        default:
            return `语音识别失败（${code}）`;
    }
};

export const useSpeechInput = (options: {
    onTranscript: (text: string) => void;
    onInterim?: (text: string) => void;
    lang?: string;
}) => {
    const { lang = "zh-CN" } = options;
    const onTranscriptRef = useRef(options.onTranscript);
    const onInterimRef = useRef(options.onInterim);

    useEffect(() => {
        onTranscriptRef.current = options.onTranscript;
        onInterimRef.current = options.onInterim;
    }, [options.onInterim, options.onTranscript]);

    const supported = useSyncExternalStore(
        subscribeSpeechSupport,
        getSpeechSupportSnapshot,
        () => false,
    );
    const [listening, setListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const listeningRef = useRef(false);
    const userStoppedRef = useRef(false);
    const pendingInterimRef = useRef("");

    const setListeningState = useCallback((next: boolean) => {
        listeningRef.current = next;
        setListening(next);
    }, []);

    const flushPendingInterim = useCallback(() => {
        const pending = pendingInterimRef.current.trim();
        pendingInterimRef.current = "";
        if (!pending)
            return;
        onTranscriptRef.current(pending);
        onInterimRef.current?.("");
    }, []);

    useEffect(() => {
        return () => {
            userStoppedRef.current = true;
            recognitionRef.current?.abort();
            recognitionRef.current = null;
        };
    }, []);

    const stop = useCallback(() => {
        userStoppedRef.current = true;
        setListeningState(false);
        const recognition = recognitionRef.current;
        if (!recognition)
            return;
        try {
            recognition.stop();
        }
        catch {
            try {
                recognition.abort();
            }
            catch {
                /* ignore */
            }
        }
    }, [setListeningState]);

    const toggle = useCallback(() => {
        const Ctor = getSpeechRecognitionCtor();
        if (!Ctor) {
            setError("当前浏览器不支持语音识别（建议 Chrome / Edge）");
            return;
        }
        if (listeningRef.current) {
            stop();
            return;
        }

        setError(null);
        userStoppedRef.current = false;
        pendingInterimRef.current = "";

        const recognition = new Ctor();
        recognition.lang = lang;
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let newFinal = "";
            let interim = "";
            for (let i = 0; i < event.results.length; i++) {
                const result = event.results[i];
                const chunk = result?.[0]?.transcript ?? "";
                if (!chunk)
                    continue;
                if (result.isFinal) {
                    if (i >= event.resultIndex)
                        newFinal += chunk;
                }
                else {
                    interim += chunk;
                }
            }
            pendingInterimRef.current = interim.trim();
            if (newFinal.trim())
                onTranscriptRef.current(newFinal.trim());
            onInterimRef.current?.(pendingInterimRef.current);
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            const message = speechErrorMessage(event.error);
            if (event.error === "no-speech" && listeningRef.current && !userStoppedRef.current)
                return;
            if (message)
                setError(message);
            userStoppedRef.current = true;
            setListeningState(false);
        };

        recognition.onend = () => {
            if (userStoppedRef.current || !listeningRef.current) {
                flushPendingInterim();
                setListeningState(false);
                recognitionRef.current = null;
                return;
            }
            try {
                recognition.start();
            }
            catch {
                flushPendingInterim();
                setListeningState(false);
                recognitionRef.current = null;
            }
        };

        recognitionRef.current = recognition;
        setListeningState(true);
        try {
            recognition.start();
        }
        catch {
            userStoppedRef.current = true;
            setListeningState(false);
            recognitionRef.current = null;
            setError("无法启动语音识别（请刷新页面后重试）");
        }
    }, [flushPendingInterim, lang, setListeningState, stop]);

    return { supported, listening, error, toggle, stop };
};

import React, { createContext, useContext, useState, useCallback } from 'react';

/**
 * GLOBAL mute context — shared across ALL video players.
 * When you mute on one post, it stays muted when you scroll to the next.
 * Tap again on any post to unmute globally.
 */

interface MuteContextType {
    isMuted: boolean;
    toggleMute: () => boolean; // Returns new muted state
}

const MuteContext = createContext<MuteContextType>({
    isMuted: false,
    toggleMute: () => false,
});

export const MuteProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isMuted, setIsMuted] = useState(false);

    const toggleMute = useCallback(() => {
        let newVal = false;
        setIsMuted(prev => {
            newVal = !prev;
            return newVal;
        });
        return newVal;
    }, []);

    return (
        <MuteContext.Provider value={{ isMuted, toggleMute }}>
            {children}
        </MuteContext.Provider>
    );
};

export const useMute = () => useContext(MuteContext);

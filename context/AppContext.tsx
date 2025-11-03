
import React, { createContext, useContext, ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import type { AppContextType, HealthData, StandardPattern, DailyData, UserDataBundle } from '../types.ts';
import { loadData, saveData } from '../services/jsonbinService.ts';
import useLocalStorage from '../hooks/useLocalStorage.ts';

const AppContext = createContext<AppContextType | undefined>(undefined);

type AppProviderProps = {
    children: ReactNode;
};

const defaultHealthData: HealthData = {};
const defaultMedications: string[] = ['Medicina A', 'Medicina B'];
const defaultStandardPattern: StandardPattern = {};
const defaultUserDataBundle: UserDataBundle = {
    healthData: defaultHealthData,
    medications: defaultMedications,
    standardPattern: defaultStandardPattern,
};


export const AppProvider = ({ children }: AppProviderProps) => {
    const [apiKey, setApiKey] = useLocalStorage<string | null>('jsonbin_api_key', null);
    const [binId, setBinId] = useLocalStorage<string | null>('jsonbin_bin_id', null);

    const [isAuthenticated, setIsAuthenticated] = useState(!!(apiKey && binId));
    const [isLoading, setIsLoading] = useState(true);
    const [isDataLoading, setIsDataLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [healthData, setHealthData] = useState<HealthData>(defaultHealthData);
    const [medications, setMedications] = useState<string[]>(defaultMedications);
    const [standardPattern, setStandardPattern] = useState<StandardPattern>(defaultStandardPattern);
    
    const healthDataRef = useRef(healthData);
    const medicationsRef = useRef(medications);
    const standardPatternRef = useRef(standardPattern);
    const authRef = useRef(isAuthenticated);

    useEffect(() => { healthDataRef.current = healthData; }, [healthData]);
    useEffect(() => { medicationsRef.current = medications; }, [medications]);
    useEffect(() => { standardPatternRef.current = standardPattern; }, [standardPattern]);
    useEffect(() => { authRef.current = isAuthenticated; }, [isAuthenticated]);

    const saveDataTimeout = useRef<number | null>(null);

    const saveDataToJsonbin = useCallback(() => {
        if (saveDataTimeout.current) {
            clearTimeout(saveDataTimeout.current);
        }
        saveDataTimeout.current = window.setTimeout(async () => {
            if (!authRef.current || !apiKey || !binId) return;
            setIsSaving(true);
            const dataBundle: UserDataBundle = {
                healthData: healthDataRef.current,
                medications: medicationsRef.current,
                standardPattern: standardPatternRef.current,
            };
            try {
                await saveData(apiKey, binId, dataBundle);
            } catch (error) {
                console.error("Failed to save data to jsonbin.io:", error);
            } finally {
                setIsSaving(false);
            }
        }, 2000);
    }, [apiKey, binId]);

    const loadInitialUserData = useCallback(async (key: string, id: string) => {
        setIsDataLoading(true);
        try {
            const data = await loadData(key, id, defaultUserDataBundle);
            setHealthData(data.healthData || defaultHealthData);
            setMedications(data.medications || defaultMedications);
            setStandardPattern(data.standardPattern || defaultStandardPattern);
        } catch (error) {
            console.error("Failed to load user data:", error);
            // Handle error, maybe sign out user or show a message
        } finally {
            setIsDataLoading(false);
        }
    }, []);

    useEffect(() => {
        setIsLoading(true);
        if (apiKey && binId) {
            setIsAuthenticated(true);
            loadInitialUserData(apiKey, binId);
        } else {
            setIsAuthenticated(false);
        }
        setIsLoading(false);
    }, [apiKey, binId, loadInitialUserData]);

    const login = (key: string, id: string) => {
        setApiKey(key);
        setBinId(id);
    };

    const logout = () => {
        setApiKey(null);
        setBinId(null);
        // Reset state on logout
        setIsAuthenticated(false);
        setHealthData(defaultHealthData);
        setMedications(defaultMedications);
        setStandardPattern(defaultStandardPattern);
    };

    const updateHealthData = async (date: string, data: DailyData) => {
        setHealthData(prev => ({ ...prev, [date]: data }));
        saveDataToJsonbin();
    };

    const addMedication = async (med: string) => {
        if (!medications.includes(med)) {
            setMedications(prev => [...prev, med].sort());
            saveDataToJsonbin();
        }
    };

    const editMedication = async (oldMed: string, newMed: string) => {
        const newHealthData: HealthData = {};
        for (const date in healthData) {
            newHealthData[date] = {};
            for (const time in healthData[date]) {
                newHealthData[date][time] = {
                    ...healthData[date][time],
                    medications: healthData[date][time].medications.map(m => (m === oldMed ? newMed : m))
                };
            }
        }

        const newStandardPattern: StandardPattern = {};
        for (const time in standardPattern) {
            newStandardPattern[time] = standardPattern[time].map(m => (m === oldMed ? newMed : m));
        }

        setHealthData(newHealthData);
        setStandardPattern(newStandardPattern);
        setMedications(prev => prev.map(m => (m === oldMed ? newMed : m)).sort());
        saveDataToJsonbin();
    };

    const deleteMedication = async (medToDelete: string) => {
        const newHealthData: HealthData = {};
        for (const date in healthData) {
            newHealthData[date] = {};
            for (const time in healthData[date]) {
                newHealthData[date][time] = {
                    ...healthData[date][time],
                    medications: healthData[date][time].medications.filter(m => m !== medToDelete)
                };
            }
        }
        
        const newStandardPattern: StandardPattern = {};
        for (const time in standardPattern) {
            const filteredMeds = standardPattern[time].filter(m => m !== medToDelete);
            if (filteredMeds.length > 0) {
                newStandardPattern[time] = filteredMeds;
            }
        }
        
        setHealthData(newHealthData);
        setStandardPattern(newStandardPattern);
        setMedications(prev => prev.filter(m => m !== medToDelete));
        saveDataToJsonbin();
    };
    
    const updateStandardPattern = async (pattern: StandardPattern) => {
        setStandardPattern(pattern);
        saveDataToJsonbin();
    };
    
    const value: AppContextType = {
        isAuthenticated,
        login,
        logout,
        healthData,
        medications,
        standardPattern,
        isLoading,
        isDataLoading,
        isSaving,
        updateHealthData,
        addMedication,
        editMedication,
        deleteMedication,
        updateStandardPattern,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = () => {
    const context = useContext(AppContext);
    if (context === undefined) {
        throw new Error('useAppContext must be used within an AppProvider');
    }
    return context;
};
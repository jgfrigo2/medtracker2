export interface TimeSlotData {
    value: number | null;
    medications: string[];
    comments: string;
}

export type DailyData = Record<string, TimeSlotData>;

export type HealthData = Record<string, DailyData>;

export type StandardPattern = Record<string, string[]>;

export interface UserDataBundle {
    healthData: HealthData;
    medications: string[];
    standardPattern: StandardPattern;
}

export interface AppContextType {
    isAuthenticated: boolean;
    login: (apiKey: string, binId: string) => void;
    logout: () => void;
    healthData: HealthData;
    medications: string[];
    standardPattern: StandardPattern;
    isLoading: boolean;
    isDataLoading: boolean;
    isSaving: boolean;
    updateHealthData: (date: string, data: DailyData) => Promise<void>;
    addMedication: (med: string) => Promise<void>;
    editMedication: (oldMed: string, newMed: string) => Promise<void>;
    deleteMedication: (med: string) => Promise<void>;
    updateStandardPattern: (pattern: StandardPattern) => Promise<void>;
}

import React, { useState, useRef, useEffect, createContext, useContext, ReactNode, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceDot } from 'recharts';
import { format, endOfMonth, eachDayOfInterval, getDay, addMonths, isSameDay, isToday, startOfMonth, subMonths } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { 
    Calendar as CalendarIcon, 
    List as ListIcon, 
    ClipboardList as ClipboardListIcon, 
    BarChart2 as BarChart2Icon, 
    Edit as EditIcon, 
    Power as PowerIcon, 
    Loader,
    ChevronLeft, 
    ChevronRight,
    Save,
    ClipboardPaste,
    Pill,
    MessageSquare,
    Plus,
    Trash2,
    Check
} from 'lucide-react';

// --- From types.ts ---
interface TimeSlotData {
    value: number | null;
    medications: string[];
    comments: string;
}
type DailyData = Record<string, TimeSlotData>;
type HealthData = Record<string, DailyData>;
type StandardPattern = Record<string, string[]>;
interface UserDataBundle {
    healthData: HealthData;
    medications: string[];
    standardPattern: StandardPattern;
}
interface AppContextType {
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

// --- From constants.ts ---
const TIME_SLOTS: string[] = [];
for (let h = 8; h < 24; h++) {
    TIME_SLOTS.push(`${h.toString().padStart(2, '0')}:00`);
    if (h < 23) {
      TIME_SLOTS.push(`${h.toString().padStart(2, '0')}:30`);
    }
}

// --- From services/jsonbinService.ts ---
const JSONBIN_API_URL = 'https://api.jsonbin.io/v3/b';

async function loadData(apiKey: string, binId: string, defaultData: UserDataBundle): Promise<UserDataBundle> {
    try {
        const response = await fetch(`${JSONBIN_API_URL}/${binId}/latest`, {
            method: 'GET',
            headers: {
                'X-Master-Key': apiKey,
                'X-Bin-Meta': 'false',
            },
        });
        if (!response.ok) {
            if (response.status === 404) {
                console.log("jsonbin.io: Bin not found or empty. Using default data.");
                return defaultData;
            }
            throw new Error(`Failed to load data from jsonbin.io: ${response.statusText}`);
        }
        const responseText = await response.text();
        if (!responseText) {
            return defaultData;
        }
        const data = JSON.parse(responseText);
        return data;
    } catch (error) {
        console.error("Error loading data from jsonbin.io, returning default.", error);
        return defaultData;
    }
}

async function saveData(apiKey: string, binId: string, data: UserDataBundle): Promise<void> {
    try {
        const response = await fetch(`${JSONBIN_API_URL}/${binId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': apiKey,
            },
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            throw new Error(`Failed to save data to jsonbin.io: ${response.statusText}`);
        }
    } catch (error) {
        console.error("Error saving data to jsonbin.io:", error);
        throw error;
    }
}

// --- From hooks/useLocalStorage.ts ---
function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.error(error);
            return initialValue;
        }
    });
    const setValue = (value: T | ((val: T) => T)) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
            console.error(error);
        }
    };
    return [storedValue, setValue];
}

// --- From context/AppContext.tsx ---
const AppContext = createContext<AppContextType | undefined>(undefined);
type AppProviderProps = { children: ReactNode; };
const defaultHealthData: HealthData = {};
const defaultMedications: string[] = ['Medicina A', 'Medicina B'];
const defaultStandardPattern: StandardPattern = {};
const defaultUserDataBundle: UserDataBundle = {
    healthData: defaultHealthData,
    medications: defaultMedications,
    standardPattern: defaultStandardPattern,
};

const AppProvider = ({ children }: AppProviderProps) => {
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
        if (saveDataTimeout.current) clearTimeout(saveDataTimeout.current);
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
                newHealthData[date][time] = { ...healthData[date][time], medications: healthData[date][time].medications.map(m => (m === oldMed ? newMed : m)) };
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
                newHealthData[date][time] = { ...healthData[date][time], medications: healthData[date][time].medications.filter(m => m !== medToDelete) };
            }
        }
        const newStandardPattern: StandardPattern = {};
        for (const time in standardPattern) {
            const filteredMeds = standardPattern[time].filter(m => m !== medToDelete);
            if (filteredMeds.length > 0) newStandardPattern[time] = filteredMeds;
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
    
    const value: AppContextType = { isAuthenticated, login, logout, healthData, medications, standardPattern, isLoading, isDataLoading, isSaving, updateHealthData, addMedication, editMedication, deleteMedication, updateStandardPattern };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

const useAppContext = () => {
    const context = useContext(AppContext);
    if (context === undefined) throw new Error('useAppContext must be used within an AppProvider');
    return context;
};

// --- From components/auth/JsonbinLoginScreen.tsx ---
const JsonbinLoginScreen = () => {
    const { login, isLoading } = useAppContext();
    const [apiKey, setApiKey] = useState('');
    const [binId, setBinId] = useState('');
    const [error, setError] = useState('');

    const handleLogin = () => {
        if (!apiKey.trim() || !binId.trim()) {
            setError('La clave API y el ID del bin son obligatorios.');
            return;
        }
        setError('');
        login(apiKey, binId);
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-slate-100">
            <div className="w-full max-w-sm p-8 space-y-6 bg-white rounded-xl shadow-lg">
                <div className="text-center">
                    <h1 className="text-3xl font-bold text-slate-800">Monitor de Salud</h1>
                    <p className="mt-2 text-slate-500">Ingrese sus credenciales de jsonbin.io para sincronizar sus datos.</p>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }} className="space-y-4">
                     <div>
                        <label htmlFor="apiKey" className="block text-sm font-medium text-slate-700 text-left">Clave API (X-Master-Key)</label>
                        <input id="apiKey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full mt-1 p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500" placeholder="Su clave API de jsonbin.io" required />
                    </div>
                     <div>
                        <label htmlFor="binId" className="block text-sm font-medium text-slate-700 text-left">ID del Bin</label>
                        <input id="binId" type="text" value={binId} onChange={(e) => setBinId(e.target.value)} className="w-full mt-1 p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500" placeholder="Su ID de bin de jsonbin.io" required />
                    </div>
                    {error && <p className="text-sm text-red-500">{error}</p>}
                    <div className="pt-2">
                        <button type="submit" disabled={isLoading} className="w-full inline-flex justify-center items-center px-4 py-3 font-semibold text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-300 disabled:bg-blue-400 disabled:cursor-not-allowed">
                            {isLoading ? 'Cargando...' : 'Iniciar sesión'}
                        </button>
                    </div>
                </form>
                 <p className="text-xs text-slate-400 text-center">Los datos se almacenarán en su bin privado de jsonbin.io.</p>
            </div>
        </div>
    );
};

// --- From components/calendar/Calendar.tsx ---
interface CalendarProps {
    currentDate: Date;
    setCurrentDate: (date: Date) => void;
    selectedDate: Date | null;
    setSelectedDate: (date: Date) => void;
}
const WEEK_DAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

const Calendar = ({ currentDate, setCurrentDate, selectedDate, setSelectedDate }: CalendarProps) => {
    const { healthData } = useAppContext();
    const startDate = startOfMonth(currentDate);
    const endDate = endOfMonth(currentDate);
    const daysInMonth = eachDayOfInterval({ start: startDate, end: endDate });
    const startingDayIndex = (getDay(startDate) + 6) % 7;

    const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));
    const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
    const today = () => {
        const now = new Date();
        setCurrentDate(now);
        setSelectedDate(now);
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <button onClick={prevMonth} className="p-2 rounded-full hover:bg-slate-100"><ChevronLeft size={20} /></button>
                <div className="text-center">
                    <h2 className="text-lg font-semibold text-slate-800 capitalize">{format(currentDate, 'MMMM yyyy', { locale: es })}</h2>
                    <button onClick={today} className="text-sm font-medium text-blue-600 hover:text-blue-800">Hoy</button>
                </div>
                <button onClick={nextMonth} className="p-2 rounded-full hover:bg-slate-100"><ChevronRight size={20} /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-sm font-medium text-slate-500">
                {WEEK_DAYS.map(day => <div key={day}>{day}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1 mt-2">
                {Array.from({ length: startingDayIndex }).map((_, index) => <div key={`empty-${index}`} />)}
                {daysInMonth.map(day => {
                    const dayFormatted = format(day, 'yyyy-MM-dd');
                    const dayData = healthData[dayFormatted];
                    const hasData = dayData && Object.values(dayData).some((d: Partial<TimeSlotData> | null) => d && (d.value != null || (Array.isArray(d.medications) && d.medications.length > 0) || !!d.comments));
                    const isSelected = selectedDate && isSameDay(day, selectedDate);
                    const isCurrentToday = isToday(day);
                    
                    return (
                        <button key={day.toString()} onClick={() => setSelectedDate(day)} className={`relative h-10 w-10 flex items-center justify-center rounded-full transition-colors duration-200 ${isSelected ? 'bg-blue-600 text-white' : ''} ${!isSelected && isCurrentToday ? 'bg-blue-100 text-blue-700' : ''} ${!isSelected && !isCurrentToday ? 'hover:bg-slate-100 text-slate-700' : ''}`}>
                            <span>{format(day, 'd')}</span>
                            {hasData && <span className={`absolute bottom-1.5 h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-blue-500'}`}></span>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

// --- From components/input/DataInputForm.tsx ---
interface DataInputFormProps { selectedDate: string; }
const defaultTimeSlotData: TimeSlotData = { value: null, medications: [], comments: '' };
const createInitialData = (): DailyData => {
    return TIME_SLOTS.reduce((acc, time) => {
        acc[time] = { ...defaultTimeSlotData, medications: [] };
        return acc;
    }, {} as DailyData);
};

const DataInputForm = ({ selectedDate }: DataInputFormProps) => {
    const { healthData, updateHealthData, medications, standardPattern } = useAppContext();
    const [dailyData, setDailyData] = useState<DailyData>(createInitialData());
    const [isSaving, setIsSaving] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    useEffect(() => {
        const existingData = healthData[selectedDate];
        const fullData = createInitialData();
        if (existingData) {
            Object.keys(existingData).forEach(time => {
                if (fullData[time]) {
                    fullData[time] = { ...defaultTimeSlotData, ...existingData[time] };
                }
            });
        }
        setDailyData(fullData);
    }, [selectedDate, healthData]);

    const handleValueChange = <K extends keyof TimeSlotData>(time: string, field: K, value: TimeSlotData[K]) => {
        setDailyData(prevData => ({ ...prevData, [time]: { ...prevData[time], [field]: value } }));
    };
    
    const handleMedicationChange = (time: string, selectedMeds: string[]) => {
       setDailyData(prevData => ({ ...prevData, [time]: { ...prevData[time], medications: selectedMeds } }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        await updateHealthData(selectedDate, dailyData);
        setIsSaving(false);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2000);
    };

    const applyStandardPattern = () => {
        setDailyData(prevData => {
            const newData = { ...prevData };
            Object.keys(standardPattern).forEach(time => {
                if (newData[time]) {
                    const existingMeds = new Set(newData[time].medications);
                    standardPattern[time].forEach(med => existingMeds.add(med));
                    newData[time] = { ...newData[time], medications: Array.from(existingMeds) };
                }
            });
            return newData;
        });
    };

    return (
        <div className="space-y-4">
            <div className="max-h-[60vh] overflow-y-auto pr-2 -mr-2">
                <table className="w-full text-sm text-left">
                     <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-[1]">
                        <tr>
                            <th scope="col" className="px-3 py-3 w-1/6">Hora</th>
                            <th scope="col" className="px-3 py-3 w-1/6">Valor (0-10)</th>
                            <th scope="col" className="px-3 py-3 w-2/6">Medicación</th>
                            <th scope="col" className="px-3 py-3 w-2/6">Comentarios</th>
                        </tr>
                    </thead>
                    <tbody>
                        {TIME_SLOTS.map(time => {
                            const timeData = dailyData[time];
                            return (
                                <tr key={time} className="bg-white border-b border-slate-200 hover:bg-slate-50">
                                    <td className="px-3 py-2 font-medium text-slate-900">{time}</td>
                                    <td className="px-3 py-2">
                                        <input type="number" min="0" max="10" step="1" value={timeData.value ?? ''} onChange={(e) => handleValueChange(time, 'value', e.target.value === '' ? null : Number(e.target.value))} className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500" />
                                    </td>
                                    <td className="px-3 py-2">
                                        <select multiple value={timeData.medications} onChange={(e) => handleMedicationChange(time, Array.from(e.target.selectedOptions, option => option.value))} className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 h-24">
                                            {medications.map(med => <option key={med} value={med}>{med}</option>)}
                                        </select>
                                    </td>
                                    <td className="px-3 py-2">
                                        <textarea value={timeData.comments} onChange={(e) => handleValueChange(time, 'comments', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500" rows={3} />
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                {showSuccess && <span className="text-sm text-green-600">¡Guardado con éxito!</span>}
                <button onClick={applyStandardPattern} className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 flex items-center gap-2 transition-colors">
                    <ClipboardPaste size={16}/> Aplicar Patrón
                </button>
                <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors disabled:bg-blue-400 disabled:cursor-not-allowed">
                    <Save size={16}/> {isSaving ? 'Guardando...' : 'Guardar Cambios'}
                </button>
            </div>
        </div>
    );
};

// --- From components/output/DataDisplay.tsx ---
interface DataDisplayProps { selectedDate: string; }
interface ChartDataPoint { time: string; value: number | null; medications: string[]; comments: string; }
const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        const valueDisplay = data.value !== null ? `Valor: ${data.value}` : 'Valor: N/A';
        return (
            <div className="bg-white p-3 rounded-lg shadow-lg border border-slate-200">
                <p className="font-bold text-slate-800">{`Hora: ${label}`}</p>
                <p className="text-blue-600">{valueDisplay}</p>
                {data.medications.length > 0 && (<div className="mt-2"><p className="font-semibold text-slate-700">Medicación:</p><ul className="list-disc list-inside text-slate-600">{data.medications.map((med: string) => <li key={med}>{med}</li>)}</ul></div>)}
                {data.comments && <p className="mt-2 text-slate-600 italic">{`Comentario: "${data.comments}"`}</p>}
            </div>
        );
    }
    return null;
};

const DataDisplay = ({ selectedDate }: DataDisplayProps) => {
    const { healthData } = useAppContext();
    const dailyData = healthData[selectedDate];

    const normalizedDailyData = useMemo(() => {
        if (!dailyData) return null;
        const defaultSlotData: TimeSlotData = { value: null, medications: [], comments: '' };
        const normalized: DailyData = {};
        for (const time in dailyData) {
            if (Object.prototype.hasOwnProperty.call(dailyData, time)) {
                const slotData = dailyData[time] && typeof dailyData[time] === 'object' ? dailyData[time] : {};
                normalized[time] = { ...defaultSlotData, ...slotData };
            }
        }
        return normalized;
    }, [dailyData]);

    const hasAnyData = normalizedDailyData && Object.values(normalizedDailyData).some((d: TimeSlotData) => d.value !== null || d.medications.length > 0 || !!d.comments);
    if (!hasAnyData) return <div className="flex items-center justify-center h-96 text-slate-500">No hay datos registrados para este día.</div>;
    
    const hasNumericData = Object.values(normalizedDailyData).some((d: TimeSlotData) => d.value !== null);

    if (!hasNumericData) {
        const entriesWithData = Object.entries(normalizedDailyData).filter(([, data]) => data.medications.length > 0 || !!data.comments).sort(([timeA], [timeB]) => timeA.localeCompare(timeB));
        return (
            <div className="p-4">
                 <div className="flex items-center justify-center text-center h-16 text-slate-500">No hay datos de valor numérico para mostrar en el gráfico, pero se encontraron los siguientes registros.</div>
                 <div className="max-h-[50vh] overflow-y-auto mt-4 space-y-3">
                     {entriesWithData.map(([time, data]) => (
                         <div key={time} className="p-3 bg-slate-50 rounded-lg flex items-start gap-4">
                             <span className="font-bold text-slate-700 w-16 pt-0.5">{time}</span>
                             <div className="flex-1 space-y-2">
                                 {data.medications.length > 0 && (<div className="flex items-start gap-2 text-sm text-slate-800"><Pill size={16} className="text-green-500 mt-0.5 flex-shrink-0"/><span>{data.medications.join(', ')}</span></div>)}
                                 {data.comments && (<div className="flex items-start gap-2 text-sm text-slate-600"><MessageSquare size={16} className="text-orange-500 mt-0.5 flex-shrink-0"/><span className="italic">"{data.comments}"</span></div>)}
                             </div>
                         </div>
                     ))}
                 </div>
            </div>
        );
    }

    const chartData: ChartDataPoint[] = Object.entries(normalizedDailyData).map(([time, data]: [string, TimeSlotData]) => ({ time, value: data.value, medications: data.medications, comments: data.comments })).sort((a, b) => a.time.localeCompare(b.time));

    return (
        <div className="h-[60vh] w-full flex flex-col">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" tickFormatter={(tick) => tick.endsWith(':00') ? tick : ''} interval={0} tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis domain={[0, 10]} allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }}/>
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="value" name="Valor" stroke="#3b82f6" strokeWidth={2} activeDot={{ r: 8 }} connectNulls dot={false}/>
                    {chartData.map((point) => {
                        if (point.value === null) return null;
                        const hasMeds = point.medications.length > 0;
                        const hasComments = !!point.comments;
                        let color = '';
                        if (hasMeds && hasComments) color = '#8B5CF6'; // violet-500
                        else if (hasMeds) color = '#10B981'; // green-500
                        else if (hasComments) color = '#F97316'; // orange-500
                        if(color) return <ReferenceDot key={`dot-${point.time}`} x={point.time} y={point.value} r={6} fill={color} stroke="#fff" strokeWidth={2} />;
                        return null;
                    })}
                </LineChart>
            </ResponsiveContainer>
            <div className="flex justify-center items-center gap-6 mt-4 text-sm text-slate-600">
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#10B981' }}></span><span>Medicación</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#F97316' }}></span><span>Comentario</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#8B5CF6' }}></span><span>Ambos</span></div>
            </div>
        </div>
    );
};

// --- From components/medication/MedicationManager.tsx ---
const MedicationManager = () => {
    const { medications, addMedication, editMedication, deleteMedication, isLoading } = useAppContext();
    const [newMed, setNewMed] = useState('');
    const [editingMed, setEditingMed] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const handleAdd = async () => {
        if (newMed.trim() && !medications.includes(newMed.trim())) {
            setIsSaving(true);
            await addMedication(newMed.trim());
            setNewMed('');
            setIsSaving(false);
        }
    };
    const handleEdit = async (med: string) => {
        if (editText.trim() && editText.trim() !== med) {
            setIsSaving(true);
            await editMedication(med, editText.trim());
            setIsSaving(false);
        }
        setEditingMed(null);
        setEditText('');
    };
    const handleDelete = async (med: string) => {
        setIsSaving(true);
        await deleteMedication(med);
        setIsSaving(false);
    };
    const startEditing = (med: string) => {
        setEditingMed(med);
        setEditText(med);
    };
    
    if (isLoading) return <div className="text-center p-8">Cargando medicamentos...</div>;

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 max-w-2xl mx-auto">
            <h2 className="text-xl font-bold text-slate-700 mb-4">Gestionar Lista de Medicamentos</h2>
            <div className="flex gap-2 mb-6">
                <input type="text" value={newMed} onChange={(e) => setNewMed(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAdd()} placeholder="Añadir nuevo medicamento" className="flex-grow p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500" disabled={isSaving} />
                <button onClick={handleAdd} disabled={isSaving || !newMed.trim()} className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:bg-blue-400">
                    <Plus size={16}/> Añadir
                </button>
            </div>
            <div className="space-y-3">
                {medications.length > 0 ? medications.map(med => (
                    <div key={med} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg min-h-[52px]">
                        {editingMed === med ? (<input type="text" value={editText} onChange={(e) => setEditText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleEdit(med)} autoFocus onBlur={() => handleEdit(med)} className="flex-grow p-1 border-b-2 border-blue-500 focus:outline-none bg-transparent" disabled={isSaving}/>) : (<span className="text-slate-800">{med}</span>)}
                        <div className="flex gap-2">
                            {editingMed === med ? (<button onClick={() => handleEdit(med)} disabled={isSaving} className="p-2 text-slate-500 hover:text-green-600 hover:bg-slate-200 rounded-full"><Check size={16}/></button>) : (<><button onClick={() => startEditing(med)} disabled={isSaving} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-slate-200 rounded-full"><EditIcon size={16}/></button><button onClick={() => handleDelete(med)} disabled={isSaving} className="p-2 text-slate-500 hover:text-red-600 hover:bg-slate-200 rounded-full"><Trash2 size={16}/></button></>)}
                        </div>
                    </div>
                )) : (<p className="text-slate-500 text-center py-4">No hay medicamentos en la lista.</p>)}
            </div>
        </div>
    );
};

// --- From components/medication/StandardPatternManager.tsx ---
const StandardPatternManager = () => {
    const { medications, standardPattern, updateStandardPattern, isLoading } = useAppContext();
    const [pattern, setPattern] = useState<StandardPattern>({});
    const [isSaving, setIsSaving] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    useEffect(() => { setPattern(standardPattern); }, [standardPattern]);

    const handleMedicationChange = (time: string, selectedMeds: string[]) => {
        setPattern(prevPattern => ({ ...prevPattern, [time]: selectedMeds }));
    };
    const handleSave = async () => {
        setIsSaving(true);
        const cleanedPattern = Object.entries(pattern).reduce((acc, [time, meds]: [string, string[]]) => {
            if (meds && meds.length > 0) acc[time] = meds;
            return acc;
        }, {} as StandardPattern);
        await updateStandardPattern(cleanedPattern);
        setIsSaving(false);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2000);
    };

    if (isLoading) return <div className="text-center p-8">Cargando patrón estándar...</div>;

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 max-w-2xl mx-auto">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-slate-700">Patrón de Medicación Estándar</h2>
                 <div className="flex items-center gap-3">
                    {showSuccess && <span className="text-sm text-green-600">¡Patrón guardado!</span>}
                    <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:bg-blue-400">
                        <Save size={16}/> {isSaving ? 'Guardando...' : 'Guardar Patrón'}
                    </button>
                </div>
            </div>
            <p className="text-sm text-slate-500 mb-6">Configure un patrón de medicación estándar. Puede aplicar este patrón en la pantalla de ingreso de datos para rellenar automáticamente la medicación de un día.</p>
            <div className="max-h-[60vh] overflow-y-auto pr-2 -mr-2 space-y-4">
                 <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-[1]">
                        <tr>
                            <th scope="col" className="px-3 py-3 w-1/4">Hora</th>
                            <th scope="col" className="px-3 py-3 w-3/4">Medicación</th>
                        </tr>
                    </thead>
                    <tbody>
                        {TIME_SLOTS.map(time => (
                            <tr key={time} className="bg-white border-b border-slate-200">
                                <td className="px-3 py-2 font-medium text-slate-900">{time}</td>
                                <td className="px-3 py-2">
                                     <select multiple value={pattern[time] || []} onChange={(e) => handleMedicationChange(time, Array.from(e.target.selectedOptions, option => option.value))} className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 h-24">
                                        {medications.map(med => <option key={med} value={med}>{med}</option>)}
                                    </select>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- From App.tsx ---
type View = 'tracker' | 'medications' | 'pattern';
type TrackerTab = 'input' | 'chart';

const App = () => {
    const { isAuthenticated, logout, isLoading, isDataLoading, isSaving } = useAppContext();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
    const [view, setView] = useState<View>('tracker');
    const [trackerTab, setTrackerTab] = useState<TrackerTab>('input');
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const calendarRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
                setIsCalendarOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [calendarRef]);

    if (isLoading) return (<div className="flex items-center justify-center min-h-screen bg-slate-100"><div className="text-slate-500">Inicializando aplicación...</div></div>);
    if (!isAuthenticated) return <JsonbinLoginScreen />;
    if (isDataLoading) return (<div className="flex items-center justify-center min-h-screen bg-slate-100"><div className="text-slate-500">Cargando datos desde jsonbin.io...</div></div>);

    const selectedDateString = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
    const handleDateSelect = (date: Date) => {
        setSelectedDate(date);
        setIsCalendarOpen(false);
    };

    const renderView = () => {
        switch (view) {
            case 'medications': return <MedicationManager />;
            case 'pattern': return <StandardPatternManager />;
            case 'tracker':
            default:
                return (
                    <div className="bg-white p-4 sm:p-6 rounded-lg shadow-sm border border-slate-200 h-full flex flex-col">
                        <div className="flex flex-wrap justify-between items-center mb-4 gap-4">
                            <div className="relative">
                                <button onClick={() => setIsCalendarOpen(!isCalendarOpen)} className="flex items-center gap-3 text-left px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors w-full sm:w-auto">
                                    <CalendarIcon size={20} className="text-slate-500"/>
                                    <div>
                                        <span className="text-xs text-slate-500">Fecha seleccionada</span>
                                        <h2 className="text-lg font-bold text-slate-700 capitalize">{selectedDate ? format(selectedDate, "eeee, d 'de' MMMM", { locale: es }) : 'Seleccionar fecha'}</h2>
                                    </div>
                                </button>
                                {isCalendarOpen && (<div ref={calendarRef} className="absolute top-full mt-2 z-20 bg-white p-4 rounded-lg shadow-xl border border-slate-200"><Calendar currentDate={currentDate} setCurrentDate={setCurrentDate} selectedDate={selectedDate} setSelectedDate={handleDateSelect} /></div>)}
                            </div>
                            {selectedDate && (
                                <div className="flex items-center bg-slate-100 rounded-lg p-1">
                                    <button onClick={() => setTrackerTab('input')} className={`px-3 py-1.5 text-sm font-semibold rounded-md flex items-center gap-2 transition-colors ${trackerTab === 'input' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:bg-slate-200'}`}><EditIcon size={16} /><span>Ingresar Datos</span></button>
                                    <button onClick={() => setTrackerTab('chart')} className={`px-3 py-1.5 text-sm font-semibold rounded-md flex items-center gap-2 transition-colors ${trackerTab === 'chart' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:bg-slate-200'}`}><BarChart2Icon size={16} /><span>Ver Gráfico</span></button>
                                </div>
                            )}
                        </div>
                        <div className="flex-grow overflow-y-auto min-h-[60vh]">
                            {isDataLoading ? (<div className="flex items-center justify-center h-full text-slate-500"><p>Cargando datos...</p></div>) : selectedDateString ? (<>{trackerTab === 'input' ? <DataInputForm selectedDate={selectedDateString} /> : <DataDisplay selectedDate={selectedDateString} />}</>) : (<div className="flex items-center justify-center h-full text-slate-500"><p>Seleccione un día para ver o ingresar datos.</p></div>)}
                        </div>
                    </div>
                );
        }
    };
    
    return (
        <div className="min-h-screen flex flex-col bg-slate-100">
            <header className="bg-white shadow-sm sticky top-0 z-10">
                <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center py-3">
                        <h1 className="text-2xl font-bold text-blue-600">Monitor de Salud</h1>
                        <div className="flex items-center gap-4">
                             <nav className="hidden sm:flex gap-1 sm:gap-2">
                                <button onClick={() => setView('tracker')} className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${view === 'tracker' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-100'}`}><CalendarIcon size={18}/> <span className="hidden sm:inline">Registro Diario</span></button>
                                <button onClick={() => setView('medications')} className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${view === 'medications' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-100'}`}><ListIcon size={18}/> <span className="hidden sm:inline">Medicamentos</span></button>
                                <button onClick={() => setView('pattern')} className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${view === 'pattern' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-100'}`}><ClipboardListIcon size={18}/> <span className="hidden sm:inline">Patrón Estándar</span></button>
                             </nav>
                             <div className="w-px h-6 bg-slate-200 hidden sm:block"></div>
                             {isSaving && (<div className="flex items-center gap-2 text-sm text-slate-500"><Loader size={16} className="animate-spin" /><span className="hidden sm:inline">Guardando...</span></div>)}
                            <button onClick={logout} className="flex items-center gap-2 p-2 text-sm font-medium rounded-full text-red-600 hover:bg-red-50 transition-colors" title="Cerrar sesión"><PowerIcon size={18}/></button>
                        </div>
                    </div>
                </div>
            </header>
            <main className="flex-grow p-4 sm:p-6 lg:p-8 max-w-screen-2xl mx-auto w-full">{renderView()}</main>
        </div>
    );
};

// --- From index.tsx (Original) ---
const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
    <React.StrictMode>
        <AppProvider>
            <App />
        </AppProvider>
    </React.StrictMode>
);

import React, { useState, useRef, useEffect, createContext, useContext, ReactNode, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceDot, ReferenceArea } from 'recharts';
// FIX: Switched to specific date-fns imports to resolve module resolution errors, likely from a version mismatch (targeting date-fns@2).
import format from 'date-fns/format';
import endOfMonth from 'date-fns/endOfMonth';
import eachDayOfInterval from 'date-fns/eachDayOfInterval';
import getDay from 'date-fns/getDay';
import addMonths from 'date-fns/addMonths';
import isSameDay from 'date-fns/isSameDay';
import isToday from 'date-fns/isToday';
import startOfMonth from 'date-fns/startOfMonth';
import subMonths from 'date-fns/subMonths';
import es from 'date-fns/locale/es';
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
    Check,
    Download,
    Upload
} from 'lucide-react';

// --- CONFIGURACIÓN DE USUARIO ---
// Por favor, reemplace estos valores con sus propias credenciales.
const APP_PASSWORD = 'password123'; // Reemplace con su contraseña deseada.
const JSONBIN_API_KEY = 'YOUR_JSONBIN_API_KEY'; // Reemplace con su X-Master-Key de jsonbin.io
const JSONBIN_BIN_ID = 'YOUR_JSONBIN_BIN_ID'; // Reemplace con su ID de bin de jsonbin.io


// --- TYPES ---
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
    login: (password: string) => boolean;
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
    loadUserDataBundle: (bundle: UserDataBundle) => Promise<void>;
}

// --- CONSTANTS ---
const TIME_SLOTS: string[] = [];
for (let h = 8; h < 24; h++) {
    TIME_SLOTS.push(`${h.toString().padStart(2, '0')}:00`);
    if (h < 23) {
      TIME_SLOTS.push(`${h.toString().padStart(2, '0')}:30`);
    }
}

// --- SERVICES ---
const JSONBIN_API_URL = 'https://api.jsonbin.io/v3/b';
async function loadDataFromBin(apiKey: string, binId: string, defaultData: UserDataBundle): Promise<UserDataBundle> {
    try {
        const response = await fetch(`${JSONBIN_API_URL}/${binId}/latest`, {
            method: 'GET',
            headers: { 'X-Master-Key': apiKey, 'X-Bin-Meta': 'false' },
        });
        if (!response.ok) {
            if (response.status === 404) return defaultData;
            throw new Error(`Failed to load: ${response.statusText}`);
        }
        const responseText = await response.text();
        return responseText ? JSON.parse(responseText) : defaultData;
    } catch (error) {
        console.error("Error loading from jsonbin.io:", error);
        return defaultData;
    }
}
async function saveDataToBin(apiKey: string, binId: string, data: UserDataBundle): Promise<void> {
    try {
        const response = await fetch(`${JSONBIN_API_URL}/${binId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Master-Key': apiKey },
            body: JSON.stringify(data),
        });
        if (!response.ok) throw new Error(`Failed to save: ${response.statusText}`);
    } catch (error) {
        console.error("Error saving to jsonbin.io:", error);
        throw error;
    }
}

// --- HOOKS ---
function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            return initialValue;
        }
    });
    const setValue = (value: T | ((val: T) => T)) => {
        const valueToStore = value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
    };
    return [storedValue, setValue];
}

// --- CONTEXT ---
const AppContext = createContext<AppContextType | undefined>(undefined);
const defaultHealthData: HealthData = {};
const defaultMedications: string[] = ['Medicina A', 'Medicina B'];
const defaultStandardPattern: StandardPattern = {};
const defaultUserDataBundle: UserDataBundle = {
    healthData: defaultHealthData,
    medications: defaultMedications,
    standardPattern: defaultStandardPattern,
};

const AppProvider = ({ children }: { children: ReactNode }) => {
    const [isAuthenticated, setIsAuthenticated] = useLocalStorage('health_app_auth', false);
    const [isLoading, setIsLoading] = useState(true);
    const [isDataLoading, setIsDataLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [healthData, setHealthData] = useState<HealthData>(defaultHealthData);
    const [medications, setMedications] = useState<string[]>(defaultMedications);
    const [standardPattern, setStandardPattern] = useState<StandardPattern>(defaultStandardPattern);
    
    const dataRef = useRef({ healthData, medications, standardPattern, isAuthenticated });
    useEffect(() => {
        dataRef.current = { healthData, medications, standardPattern, isAuthenticated };
    }, [healthData, medications, standardPattern, isAuthenticated]);

    const saveDataTimeout = useRef<number | null>(null);

    const saveDataToJsonbin = useCallback(() => {
        if (saveDataTimeout.current) clearTimeout(saveDataTimeout.current);
        saveDataTimeout.current = window.setTimeout(async () => {
            if (!dataRef.current.isAuthenticated) return;
            setIsSaving(true);
            const dataBundle: UserDataBundle = {
                healthData: dataRef.current.healthData,
                medications: dataRef.current.medications,
                standardPattern: dataRef.current.standardPattern,
            };
            try {
                await saveDataToBin(JSONBIN_API_KEY, JSONBIN_BIN_ID, dataBundle);
            } catch (error) {
                console.error("Failed to save:", error);
            } finally {
                setIsSaving(false);
            }
        }, 2000);
    }, []);

    const loadInitialUserData = useCallback(async () => {
        setIsDataLoading(true);
        try {
            const data = await loadDataFromBin(JSONBIN_API_KEY, JSONBIN_BIN_ID, defaultUserDataBundle);
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
        if (isAuthenticated) {
            loadInitialUserData();
        }
        setIsLoading(false);
    }, [isAuthenticated, loadInitialUserData]);

    const login = (password: string): boolean => {
        if (password === APP_PASSWORD) {
            setIsAuthenticated(true);
            return true;
        }
        return false;
    };
    const logout = () => {
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
        setHealthData(prev => Object.entries(prev).reduce((acc, [date, daily]) => {
            acc[date] = Object.entries(daily).reduce((dAcc, [time, slot]) => {
                dAcc[time] = { ...slot, medications: slot.medications.map(m => m === oldMed ? newMed : m) };
                return dAcc;
            }, {} as DailyData);
            return acc;
        }, {} as HealthData));
        setStandardPattern(prev => Object.entries(prev).reduce((acc, [time, meds]) => {
            acc[time] = meds.map(m => m === oldMed ? newMed : m);
            return acc;
        }, {} as StandardPattern));
        setMedications(prev => prev.map(m => (m === oldMed ? newMed : m)).sort());
        saveDataToJsonbin();
    };
    const deleteMedication = async (medToDelete: string) => {
        setHealthData(prev => Object.entries(prev).reduce((acc, [date, daily]) => {
            acc[date] = Object.entries(daily).reduce((dAcc, [time, slot]) => {
                dAcc[time] = { ...slot, medications: slot.medications.filter(m => m !== medToDelete) };
                return dAcc;
            }, {} as DailyData);
            return acc;
        }, {} as HealthData));
        setStandardPattern(prev => Object.entries(prev).reduce((acc, [time, meds]) => {
            const filtered = meds.filter(m => m !== medToDelete);
            if(filtered.length > 0) acc[time] = filtered;
            return acc;
        }, {} as StandardPattern));
        setMedications(prev => prev.filter(m => m !== medToDelete));
        saveDataToJsonbin();
    };
    const updateStandardPattern = async (pattern: StandardPattern) => {
        setStandardPattern(pattern);
        saveDataToJsonbin();
    };
    const loadUserDataBundle = async (bundle: UserDataBundle) => {
        if (bundle && bundle.healthData && bundle.medications && bundle.standardPattern) {
            setHealthData(bundle.healthData);
            setMedications(bundle.medications);
            setStandardPattern(bundle.standardPattern);
            saveDataToJsonbin();
        } else {
            throw new Error("Invalid data structure in JSON file.");
        }
    };
    const value: AppContextType = { isAuthenticated, login, logout, healthData, medications, standardPattern, isLoading, isDataLoading, isSaving, updateHealthData, addMedication, editMedication, deleteMedication, updateStandardPattern, loadUserDataBundle };
    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
const useAppContext = () => {
    const context = useContext(AppContext);
    if (context === undefined) throw new Error('useAppContext must be used within an AppProvider');
    return context;
};

// --- COMPONENTS ---

const LoginScreen = () => {
    const { login } = useAppContext();
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleLogin = () => {
        if (!password.trim()) {
            setError('La contraseña es obligatoria.');
            return;
        }
        const success = login(password);
        if (!success) {
            setError('Contraseña incorrecta.');
            setPassword('');
        } else {
            setError('');
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-slate-100">
            <div className="w-full max-w-sm p-8 space-y-6 bg-white rounded-xl shadow-lg">
                <div className="text-center">
                    <h1 className="text-3xl font-bold text-slate-800">Monitor de Salud</h1>
                    <p className="mt-2 text-slate-500">Ingrese la contraseña para acceder.</p>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }} className="space-y-4">
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-slate-700 text-left">Contraseña</label>
                        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full mt-1 p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500" placeholder="Su contraseña" required />
                    </div>
                    {error && <p className="text-sm text-red-500">{error}</p>}
                    <div className="pt-2">
                        <button type="submit" className="w-full inline-flex justify-center items-center px-4 py-3 font-semibold text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-300">
                            Iniciar sesión
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const Calendar = ({ currentDate, setCurrentDate, selectedDate, setSelectedDate }: { currentDate: Date, setCurrentDate: (d: Date) => void, selectedDate: Date | null, setSelectedDate: (d: Date) => void }) => {
    const { healthData } = useAppContext();
    const startDate = startOfMonth(currentDate);
    const endDate = endOfMonth(currentDate);
    const daysInMonth = eachDayOfInterval({ start: startDate, end: endDate });
    const startingDayIndex = (getDay(startDate) + 6) % 7;
    const WEEK_DAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-2 rounded-full hover:bg-slate-100"><ChevronLeft size={20} /></button>
                <div className="text-center">
                    <h2 className="text-lg font-semibold text-slate-800 capitalize">{format(currentDate, 'MMMM yyyy', { locale: es })}</h2>
                    <button onClick={() => { const now = new Date(); setCurrentDate(now); setSelectedDate(now); }} className="text-sm font-medium text-blue-600 hover:text-blue-800">Hoy</button>
                </div>
                <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-2 rounded-full hover:bg-slate-100"><ChevronRight size={20} /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-sm font-medium text-slate-500">{WEEK_DAYS.map(day => <div key={day}>{day}</div>)}</div>
            <div className="grid grid-cols-7 gap-1 mt-2">
                {Array.from({ length: startingDayIndex }).map((_, i) => <div key={`e-${i}`} />)}
                {daysInMonth.map(day => {
                    const dayFormatted = format(day, 'yyyy-MM-dd');
                    const dayData = healthData[dayFormatted];
                    const hasData = dayData && Object.values(dayData).some(d => d && (d.value != null || (d.medications?.length > 0) || d.comments));
                    const isSelected = selectedDate && isSameDay(day, selectedDate);
                    return (<button key={day.toString()} onClick={() => setSelectedDate(day)} className={`relative h-10 w-10 flex items-center justify-center rounded-full transition-colors ${isSelected ? 'bg-blue-600 text-white' : isToday(day) ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100 text-slate-700'}`}>
                        <span>{format(day, 'd')}</span>
                        {hasData && <span className={`absolute bottom-1.5 h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-blue-500'}`}></span>}
                    </button>);
                })}
            </div>
        </div>
    );
};

const DataInputForm = ({ selectedDate }: { selectedDate: string }) => {
    const { healthData, updateHealthData, medications, standardPattern } = useAppContext();
    const defaultTimeSlotData: TimeSlotData = { value: null, medications: [], comments: '' };
    const createInitialData = useCallback(() => TIME_SLOTS.reduce((acc, time) => ({...acc, [time]: {...defaultTimeSlotData, medications: []}}), {} as DailyData), []);
    const [dailyData, setDailyData] = useState<DailyData>(createInitialData());
    const [isSaving, setIsSaving] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    useEffect(() => {
        const existingData = healthData[selectedDate];
        const fullData = createInitialData();
        if (existingData) Object.keys(existingData).forEach(time => {
            if (fullData[time]) fullData[time] = { ...defaultTimeSlotData, ...existingData[time] };
        });
        setDailyData(fullData);
    }, [selectedDate, healthData, createInitialData]);
    
    const handleValueChange = (time: string, field: keyof TimeSlotData, value: any) => setDailyData(p => ({...p, [time]: {...p[time], [field]: value}}));
    const handleMedicationChange = (time: string, selectedMeds: string[]) => setDailyData(p => ({...p, [time]: {...p[time], medications: selectedMeds}}));
    const handleSave = async () => {
        setIsSaving(true);
        await updateHealthData(selectedDate, dailyData);
        setIsSaving(false);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2000);
    };
    const applyStandardPattern = () => setDailyData(prev => {
        const newData = {...prev};
        Object.keys(standardPattern).forEach(time => {
            if(newData[time]) {
                const combinedMeds = Array.from(new Set([...newData[time].medications, ...standardPattern[time]]));
                newData[time] = {...newData[time], medications: combinedMeds};
            }
        });
        return newData;
    });

    return (
        <div className="space-y-4">
            <div className="max-h-[60vh] overflow-y-auto pr-2 -mr-2">
                <table className="w-full text-sm">
                     <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-[1]"><tr><th className="px-3 py-3 w-1/6">Hora</th><th className="px-3 py-3 w-1/6">Valor (0-10)</th><th className="px-3 py-3 w-2/6">Medicación</th><th className="px-3 py-3 w-2/6">Comentarios</th></tr></thead>
                    <tbody>{TIME_SLOTS.map(time => {
                        const timeData = dailyData[time];
                        return (<tr key={time} className="bg-white border-b border-slate-200 hover:bg-slate-50">
                            <td className="px-3 py-2 font-medium">{time}</td>
                            <td className="px-3 py-2"><input type="number" min="0" max="10" step="1" value={timeData.value ?? ''} onChange={(e) => handleValueChange(time, 'value', e.target.value === '' ? null : Number(e.target.value))} className="w-full p-2 border border-slate-300 rounded-md" /></td>
                            <td className="px-3 py-2"><select multiple value={timeData.medications} onChange={(e) => handleMedicationChange(time, Array.from(e.target.selectedOptions, o => o.value))} className="w-full p-2 border border-slate-300 rounded-md h-24">{medications.map(m => <option key={m} value={m}>{m}</option>)}</select></td>
                            <td className="px-3 py-2"><textarea value={timeData.comments} onChange={(e) => handleValueChange(time, 'comments', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md" rows={3} /></td>
                        </tr>)})}</tbody>
                </table>
            </div>
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                {showSuccess && <span className="text-sm text-green-600">¡Guardado!</span>}
                <button onClick={applyStandardPattern} className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 flex items-center gap-2"><ClipboardPaste size={16}/> Aplicar Patrón</button>
                <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:bg-blue-400"><Save size={16}/> {isSaving ? 'Guardando...' : 'Guardar'}</button>
            </div>
        </div>
    );
};

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload?.length) {
        const data = payload[0].payload;
        return (<div className="bg-white p-3 rounded-lg shadow-lg border">
            <p className="font-bold">{`Hora: ${label}`}</p>
            <p className="text-blue-600">{data.value !== null ? `Valor: ${data.value}` : 'N/A'}</p>
            {data.medications.length > 0 && <div className="mt-2"><p className="font-semibold">Medicación:</p><ul className="list-disc list-inside">{data.medications.map((m: string) => <li key={m}>{m}</li>)}</ul></div>}
            {data.comments && <p className="mt-2 italic">{`"${data.comments}"`}</p>}
        </div>);
    } return null;
};
const DataDisplay = ({ selectedDate }: { selectedDate: string }) => {
    const { healthData } = useAppContext();
    const dailyData = healthData[selectedDate];
    const chartData = useMemo(() => dailyData ? Object.entries(dailyData).map(([time, data]) => ({ time, ...data })).sort((a, b) => a.time.localeCompare(b.time)) : [], [dailyData]);
    if (!chartData.length || chartData.every(d => d.value === null && d.medications.length === 0 && !d.comments)) return <div className="flex items-center justify-center h-96 text-slate-500">No hay datos para este día.</div>;
    if (chartData.every(d => d.value === null)) return (<div className="p-4"><div className="text-center h-16 text-slate-500">No hay datos numéricos para el gráfico.</div><div className="max-h-[50vh] overflow-y-auto mt-4 space-y-3">{chartData.filter(d => d.medications.length > 0 || d.comments).map(({time, medications, comments}) => (<div key={time} className="p-3 bg-slate-50 rounded-lg flex gap-4"><span className="font-bold w-16">{time}</span><div className="flex-1 space-y-2">{medications.length > 0 && <div className="flex items-start gap-2 text-sm"><Pill size={16} className="text-green-500 mt-0.5"/><span>{medications.join(', ')}</span></div>}{comments && <div className="flex items-start gap-2 text-sm"><MessageSquare size={16} className="text-orange-500 mt-0.5"/><span className="italic">"{comments}"</span></div>}</div></div>))}</div></div>);

    return (<div className="h-[60vh] w-full flex flex-col">
        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <ReferenceArea y1={8} y2={10.5} fill="#fecaca" fillOpacity={0.3} label={{ value: 'Alto', position: 'insideTopLeft', fill: '#b91c1c', dy: 10, dx:10 }}/>
                <ReferenceArea y1={3} y2={8} fill="#fef9c3" fillOpacity={0.4} label={{ value: 'Medio', position: 'insideTopLeft', fill: '#b45309', dy: 10, dx:10 }}/>
                <ReferenceArea y1={0} y2={3} fill="#dbeafe" fillOpacity={0.3} label={{ value: 'Bajo', position: 'insideTopLeft', fill: '#1d4ed8', dy: 10, dx:10 }}/>
                <XAxis dataKey="time" tickFormatter={tick => tick.endsWith(':00') ? tick : ''} interval={0} tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 10]} allowDecimals={false} tick={{ fontSize: 12 }}/>
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} activeDot={{ r: 8 }} connectNulls dot={false}/>
                {chartData.map(p => {
                    if (p.value === null) return null;
                    const hasMeds = p.medications.length > 0, hasComments = !!p.comments;
                    let color = '';
                    if (hasMeds && hasComments) color = '#8B5CF6';
                    else if (hasMeds) color = '#10B981';
                    else if (hasComments) color = '#F97316';
                    return color ? <ReferenceDot key={`d-${p.time}`} x={p.time} y={p.value} r={6} fill={color} stroke="#fff" strokeWidth={2} /> : null;
                })}
            </LineChart>
        </ResponsiveContainer>
        <div className="flex justify-center items-center gap-6 mt-4 text-sm"><div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#10B981]"></span>Medicación</div><div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#F97316]"></span>Comentario</div><div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#8B5CF6]"></span>Ambos</div></div>
    </div>);
};

const MedicationManager = () => {
    const { medications, addMedication, editMedication, deleteMedication, isLoading } = useAppContext();
    const [newMed, setNewMed] = useState('');
    const [editingMed, setEditingMed] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    
    const handleAction = async (action: () => Promise<void>) => { setIsSaving(true); await action(); setIsSaving(false); };
    const handleAdd = () => handleAction(async () => { if (newMed.trim() && !medications.includes(newMed.trim())) { await addMedication(newMed.trim()); setNewMed(''); } });
    const handleEdit = (med: string) => handleAction(async () => { if (editText.trim() && editText.trim() !== med) await editMedication(med, editText.trim()); setEditingMed(null); setEditText(''); });
    const handleDelete = (med: string) => handleAction(() => deleteMedication(med));

    if (isLoading) return <div className="text-center p-8">Cargando...</div>;
    return (<div className="bg-white p-6 rounded-lg shadow-sm border max-w-2xl mx-auto">
        <h2 className="text-xl font-bold mb-4">Gestionar Medicamentos</h2>
        <div className="flex gap-2 mb-6"><input type="text" value={newMed} onChange={e => setNewMed(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} placeholder="Añadir nuevo medicamento" className="flex-grow p-2 border rounded-md" disabled={isSaving} /><button onClick={handleAdd} disabled={isSaving || !newMed.trim()} className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:bg-blue-400"><Plus size={16}/> Añadir</button></div>
        <div className="space-y-3">{medications.length > 0 ? medications.map(med => (<div key={med} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg min-h-[52px]">{editingMed === med ? <input type="text" value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleEdit(med)} autoFocus onBlur={() => handleEdit(med)} className="flex-grow p-1 border-b-2 border-blue-500 bg-transparent" disabled={isSaving}/> : <span>{med}</span>}<div className="flex gap-2">{editingMed === med ? <button onClick={() => handleEdit(med)} disabled={isSaving} className="p-2 text-slate-500 hover:text-green-600 rounded-full"><Check size={16}/></button> : <><button onClick={() => { setEditingMed(med); setEditText(med); }} disabled={isSaving} className="p-2 text-slate-500 hover:text-blue-600 rounded-full"><EditIcon size={16}/></button><button onClick={() => handleDelete(med)} disabled={isSaving} className="p-2 text-slate-500 hover:text-red-600 rounded-full"><Trash2 size={16}/></button></>}</div></div>)) : <p className="text-center py-4">No hay medicamentos.</p>}</div>
    </div>);
};

const StandardPatternManager = () => {
    const { medications, standardPattern, updateStandardPattern, isLoading } = useAppContext();
    const [pattern, setPattern] = useState<StandardPattern>({});
    const [isSaving, setIsSaving] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    useEffect(() => { setPattern(standardPattern); }, [standardPattern]);
    const handleMedicationChange = (time: string, selectedMeds: string[]) => setPattern(p => ({ ...p, [time]: selectedMeds }));
    const handleSave = async () => {
        setIsSaving(true);
        const cleanedPattern = Object.entries(pattern).reduce((acc, [time, meds]) => {
            if (meds?.length > 0) acc[time] = meds;
            return acc;
        }, {} as StandardPattern);
        await updateStandardPattern(cleanedPattern);
        setIsSaving(false);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2000);
    };

    if (isLoading) return <div className="text-center p-8">Cargando patrón...</div>;
    return (<div className="bg-white p-6 rounded-lg shadow-sm border max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Patrón Estándar</h2><div className="flex items-center gap-3">{showSuccess && <span className="text-sm text-green-600">¡Guardado!</span>}<button onClick={handleSave} disabled={isSaving} className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:bg-blue-400"><Save size={16}/> {isSaving ? 'Guardando...' : 'Guardar'}</button></div></div>
        <p className="text-sm text-slate-500 mb-6">Configure un patrón de medicación para aplicar rápidamente en el registro diario.</p>
        <div className="max-h-[60vh] overflow-y-auto pr-2 -mr-2"><table className="w-full text-sm"><thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-[1]"><tr><th className="px-3 py-3 w-1/4">Hora</th><th className="px-3 py-3 w-3/4">Medicación</th></tr></thead><tbody>{TIME_SLOTS.map(time => (<tr key={time} className="bg-white border-b"><td className="px-3 py-2 font-medium">{time}</td><td className="px-3 py-2"><select multiple value={pattern[time] || []} onChange={(e) => handleMedicationChange(time, Array.from(e.target.selectedOptions, o => o.value))} className="w-full p-2 border rounded-md h-24">{medications.map(med => <option key={med} value={med}>{med}</option>)}</select></td></tr>))}</tbody></table></div>
    </div>);
};

// --- MAIN APP COMPONENT ---
type View = 'tracker' | 'medications' | 'pattern';
type TrackerTab = 'input' | 'chart';
const App = () => {
    const { isAuthenticated, logout, isLoading, isDataLoading, isSaving, healthData, medications, standardPattern, loadUserDataBundle } = useAppContext();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
    const [view, setView] = useState<View>('tracker');
    const [trackerTab, setTrackerTab] = useState<TrackerTab>('input');
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const calendarRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => { if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) setIsCalendarOpen(false); };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleExport = () => {
        const dataStr = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ healthData, medications, standardPattern }, null, 2))}`;
        const link = document.createElement("a");
        link.href = dataStr;
        link.download = `salud-datos-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
    };
    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedData = JSON.parse(e.target?.result as string);
                await loadUserDataBundle(importedData);
                alert('Datos importados y sincronizados con éxito.');
            } catch (error: any) { alert(`Error al importar: ${error.message}`); }
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    if (isLoading) return <div className="flex items-center justify-center min-h-screen"><Loader className="animate-spin"/></div>;
    if (!isAuthenticated) return <LoginScreen />;
    if (isDataLoading) return <div className="flex items-center justify-center min-h-screen">Cargando datos...</div>;

    const selectedDateString = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;

    const renderView = () => {
        switch (view) {
            case 'medications': return <MedicationManager />;
            case 'pattern': return <StandardPatternManager />;
            default: return (<div className="bg-white p-6 rounded-lg shadow-sm border h-full flex flex-col">
                <div className="flex flex-wrap justify-between items-center mb-4 gap-4">
                    <div className="relative"><button onClick={() => setIsCalendarOpen(p => !p)} className="flex items-center gap-3 text-left px-4 py-2 bg-slate-50 border rounded-lg hover:bg-slate-100"><CalendarIcon size={20} /><div ><span className="text-xs text-slate-500">Fecha</span><h2 className="text-lg font-bold capitalize">{selectedDate ? format(selectedDate, "eeee, d 'de' MMMM", { locale: es }) : ''}</h2></div></button>{isCalendarOpen && <div ref={calendarRef} className="absolute top-full mt-2 z-20 bg-white p-4 rounded-lg shadow-xl border"><Calendar currentDate={currentDate} setCurrentDate={setCurrentDate} selectedDate={selectedDate} setSelectedDate={(d) => { setSelectedDate(d); setIsCalendarOpen(false); }} /></div>}</div>
                    {selectedDate && <div className="flex items-center bg-slate-100 rounded-lg p-1"><button onClick={() => setTrackerTab('input')} className={`px-3 py-1.5 text-sm font-semibold rounded-md flex items-center gap-2 ${trackerTab === 'input' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600'}`}><EditIcon size={16} /><span>Ingresar</span></button><button onClick={() => setTrackerTab('chart')} className={`px-3 py-1.5 text-sm font-semibold rounded-md flex items-center gap-2 ${trackerTab === 'chart' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600'}`}><BarChart2Icon size={16} /><span>Gráfico</span></button></div>}
                </div>
                <div className="flex-grow overflow-y-auto min-h-[60vh]">{selectedDateString ? (trackerTab === 'input' ? <DataInputForm selectedDate={selectedDateString} /> : <DataDisplay selectedDate={selectedDateString} />) : <p className="flex items-center justify-center h-full">Seleccione un día.</p>}</div>
            </div>);
        }
    };

    return (<div className="min-h-screen flex flex-col bg-slate-100">
        <header className="bg-white shadow-sm sticky top-0 z-10"><div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8"><div className="flex justify-between items-center py-3">
            <h1 className="text-2xl font-bold text-blue-600">Monitor de Salud</h1>
            <div className="flex items-center gap-4">
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".json" style={{ display: 'none' }} />
                <button onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg" title="Importar JSON"><Upload size={18}/></button>
                <button onClick={handleExport} className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg" title="Exportar JSON"><Download size={18}/></button>
                <nav className="hidden sm:flex gap-2 border-l pl-4 ml-2"><button onClick={() => setView('tracker')} className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg ${view === 'tracker' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-100'}`}><CalendarIcon size={18}/><span>Registro</span></button><button onClick={() => setView('medications')} className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg ${view === 'medications' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-100'}`}><ListIcon size={18}/><span>Medicamentos</span></button><button onClick={() => setView('pattern')} className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg ${view === 'pattern' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-100'}`}><ClipboardListIcon size={18}/><span>Patrón</span></button></nav>
                <div className="w-px h-6 bg-slate-200 hidden sm:block"></div>
                {isSaving && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader size={16} className="animate-spin" /><span>Guardando...</span></div>}
                <button onClick={logout} className="p-2 text-red-600 hover:bg-red-50 rounded-full" title="Cerrar sesión"><PowerIcon size={18}/></button>
            </div>
        </div></div></header>
        <main className="flex-grow p-4 sm:p-6 lg:p-8 max-w-screen-2xl mx-auto w-full">{renderView()}</main>
    </div>);
};

// --- RENDER ---
const container = document.getElementById('root');
if (container) {
    const root = ReactDOM.createRoot(container);
    root.render(
        <React.StrictMode>
            <AppProvider>
                <App />
            </AppProvider>
        </React.StrictMode>
    );
}
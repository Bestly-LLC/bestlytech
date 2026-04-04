import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { fetchHomebridgeStats, HomebridgeStats, homebridgeRestart } from "@/services/homeHubApi";
import { Plug, Package, Clock, Lock, Unlock, Fan, Thermometer, Camera, DoorOpen, ArrowUpCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const ACCESSORY_ICONS: Record<string, any> = {
  lock: Lock,
  fan: Fan,
  thermostat: Thermometer,
  camera: Camera,
  door: DoorOpen,
};

function statusColor(status: string) {
  if (["locked", "on", "streaming", "closed"].includes(status)) return "bg-green-500";
  if (["unlocked", "open"].includes(status)) return "bg-yellow-500";
  return "bg-white/30";
}

export default function HomeHubHomebridge() {
  const [data, setData] = useState<HomebridgeStats | null>(null);
  const [restarting, setRestarting] = useState(false);

  const load = useCallback(async () => {
    setData(await fetchHomebridgeStats());
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRestart = async () => {
    setRestarting(true);
    await homebridgeRestart();
    toast.success("Homebridge restarted successfully");
    setRestarting(false);
    load();
  };

  if (!data) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Homebridge"
        description="HomeKit accessory bridge"
        actions={
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="border-white/10 text-white/60 hover:text-white hover:bg-white/5">
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${restarting ? "animate-spin" : ""}`} />
                Restart Homebridge
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-[#111] border-white/10">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">Restart Homebridge?</AlertDialogTitle>
                <AlertDialogDescription className="text-white/50">This will temporarily disconnect all accessories. They'll reconnect automatically in ~30 seconds.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-white/10 text-white/60 hover:bg-white/5">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleRestart} className="bg-white text-black hover:bg-white/90">Restart</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Accessories" value={data.accessories.length} icon={Plug} />
        <StatCard label="Plugins" value={data.plugins.length} icon={Package} />
        <StatCard label="Uptime" value={data.uptime} icon={Clock} />
      </div>

      {/* Accessories */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl">
        <div className="p-4 sm:p-6 pb-3">
          <h3 className="text-sm font-semibold text-white">Accessories</h3>
        </div>
        <div className="divide-y divide-white/[0.06]">
          {data.accessories.map((a) => {
            const Icon = ACCESSORY_ICONS[a.type] || Plug;
            return (
              <div key={a.name} className="flex items-center gap-3 px-4 sm:px-6 py-3">
                <div className="h-9 w-9 rounded-xl bg-white/[0.05] flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-white/40" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white/80">{a.name}</p>
                  <p className="text-xs text-white/30">{a.details}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${statusColor(a.status)}`} />
                  <span className="text-xs text-white/50 capitalize">{a.status}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Plugins */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl">
        <div className="p-4 sm:p-6 pb-3">
          <h3 className="text-sm font-semibold text-white">Plugins</h3>
        </div>
        <div className="divide-y divide-white/[0.06]">
          {data.plugins.map((p) => (
            <div key={p.name} className="flex items-center justify-between px-4 sm:px-6 py-3">
              <div className="min-w-0">
                <p className="text-sm text-white/80 font-mono">{p.name}</p>
                <p className="text-xs text-white/30">v{p.version}</p>
              </div>
              {p.updateAvailable ? (
                <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] gap-1">
                  <ArrowUpCircle className="h-3 w-3" />
                  {p.updateAvailable}
                </Badge>
              ) : (
                <Badge variant="outline" className="border-white/10 text-white/30 text-[10px]">Up to date</Badge>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

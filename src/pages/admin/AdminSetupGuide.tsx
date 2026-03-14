import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Save, Trash2 } from "lucide-react";

interface GuidanceEntry {
  id: string;
  platform: string;
  section: string;
  field_name: string;
  guidance_text: string;
  answer_recommendation: string | null;
  reason: string | null;
  display_order: number;
}

export default function AdminSetupGuide() {
  const [entries, setEntries] = useState<GuidanceEntry[]>([]);
  const [platform, setPlatform] = useState("Amazon");
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const { data } = await supabase.from("setup_guidance").select("*").order("display_order");
    setEntries(data || []);
  };

  const filtered = entries.filter((e) => e.platform === platform);
  const sections = [...new Set(filtered.map((e) => e.section))];

  const updateEntry = (id: string, field: keyof GuidanceEntry, value: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  };

  const saveEntry = async (entry: GuidanceEntry) => {
    const { error } = await supabase
      .from("setup_guidance")
      .update({
        section: entry.section,
        field_name: entry.field_name,
        guidance_text: entry.guidance_text,
        answer_recommendation: entry.answer_recommendation,
        reason: entry.reason,
        display_order: entry.display_order,
      })
      .eq("id", entry.id);

    if (error) {
      toast({ title: "Error saving", variant: "destructive" });
    } else {
      toast({ title: "Saved" });
    }
  };

  const addEntry = async () => {
    const maxOrder = Math.max(0, ...filtered.map((e) => e.display_order));
    const { error } = await supabase.from("setup_guidance").insert({
      platform,
      section: "New Section",
      field_name: "New Field",
      guidance_text: "Enter guidance...",
      display_order: maxOrder + 1,
    });
    if (!error) loadData();
  };

  const deleteEntry = async (id: string) => {
    await supabase.from("setup_guidance").delete().eq("id", id);
    loadData();
  };

  return (
    <div className="space-y-4 max-w-4xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Setup Guide</h1>
          <Button onClick={addEntry} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Add Entry
          </Button>
        </div>

        <Tabs value={platform} onValueChange={setPlatform}>
          <TabsList>
            <TabsTrigger value="Amazon">Amazon</TabsTrigger>
            <TabsTrigger value="Shopify">Shopify</TabsTrigger>
            <TabsTrigger value="TikTok">TikTok</TabsTrigger>
          </TabsList>

          <TabsContent value={platform} className="space-y-4 mt-4">
            {sections.map((section) => (
              <Card key={section}>
                <CardHeader>
                  <CardTitle className="text-base">{section}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {filtered
                    .filter((e) => e.section === section)
                    .map((entry) => (
                      <div key={entry.id} className="grid gap-2 p-3 rounded-md border">
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            value={entry.section}
                            onChange={(e) => updateEntry(entry.id, "section", e.target.value)}
                            placeholder="Section"
                          />
                          <Input
                            value={entry.field_name}
                            onChange={(e) => updateEntry(entry.id, "field_name", e.target.value)}
                            placeholder="Field Name"
                          />
                        </div>
                        <Textarea
                          value={entry.guidance_text}
                          onChange={(e) => updateEntry(entry.id, "guidance_text", e.target.value)}
                          placeholder="Guidance text"
                          rows={2}
                        />
                        <Input
                          value={entry.answer_recommendation || ""}
                          onChange={(e) => updateEntry(entry.id, "answer_recommendation", e.target.value)}
                          placeholder="Recommended answer"
                        />
                        <Input
                          value={entry.reason || ""}
                          onChange={(e) => updateEntry(entry.id, "reason", e.target.value)}
                          placeholder="Reason"
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => deleteEntry(entry.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                          <Button size="sm" onClick={() => saveEntry(entry)}>
                            <Save className="h-4 w-4 mr-1" /> Save
                          </Button>
                        </div>
                      </div>
                    ))}
                </CardContent>
              </Card>
            ))}

            {sections.length === 0 && (
              <p className="text-center text-muted-foreground py-8">
                No entries for {platform}. Click "Add Entry" to create one.
              </p>
            )}
          </TabsContent>
        </Tabs>
    </div>
  );
}

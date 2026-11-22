/* next/config.js: the switches that turn the previews into the real thing.
   Empty values keep the labelled PREVIEW (nothing leaves the device, nothing
   is charged). These two values are public by design (Supabase's URL and its
   publishable/anon key are meant for browsers; Row Level Security protects
   the data). Secret keys never go here: Polar's token and Supabase's
   service_role key live only in Supabase's secrets (supabase/SETUP.md). */
window.OUTCLIP_CONFIG = {
  supabaseUrl: "https://thfwydpugnvwwzmrhszz.supabase.co",   // Ethlenos project, senotel's Org (Singapore)
  supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoZnd5ZHB1Z252d3d6bXJoc3p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzMDk5MzQsImV4cCI6MjExMDg4NTkzNH0.gD69OcjCj-JDSVqU4Y3x9OziTuby0hHl9ucZM8GnKZY",   // the anon key (public by design)
  oauth: [],              // add "google" / "apple" once each is switched on in Supabase > Authentication > Providers
  instantSignup: true,   // 0.92.0: sign up with email + password, no code (Supabase "Confirm email" is off until our own email domain works)
  payments: false        // true once Polar is connected (the bank account is linked)
};

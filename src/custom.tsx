import { useEffect } from "react";
import { supabase } from "core/supabase";
import { useUser } from "@clerk/chrome-extension";

function useEnsureUserExists() {
  const { isLoaded, isSignedIn, user } = useUser();

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;

    async function checkAndAddUser() {
      try {
        // Query the "users" table to see if a record with this Clerk user ID exists.
        const { data, error } = await supabase
          .from("users")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) {
          console.error("Error fetching user:", error);
          return;
        }

        // If no record is found, insert a new user record.
        if (!data) {
          const { error: insertError } = await supabase
            .from("users")
            .insert({
              user_id: user.id,
              url: "",         // Default value; update as needed.
              description: "", // Default value; update as needed.
              category: "",    // Default value; update as needed.
            });

          if (insertError) {
            console.error("Error inserting user:", insertError);
          } else {
            console.log("User successfully added to the database.");
          }
        } else {
          console.log("User already exists in the database.");
        }
      } catch (err) {
        console.error("Unexpected error:", err);
      }
    }

    checkAndAddUser();
  }, [isLoaded, isSignedIn, user]);
}

export default useEnsureUserExists;


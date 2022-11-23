const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const uri =
  "mongodb+srv://docPortal:E37VzqaIAzVhn7Pj@cluster0.tsmlaiu.mongodb.net/test";
// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.tsmlaiu.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send("Unauthorized Access");
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden Access" });
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    const appointmentOptionCollection = client
      .db("doctorsPortal")
      .collection("appointmentOptions");
    const bookingsCollection = client
      .db("doctorsPortal")
      .collection("bookings");
    const usersCollection = client.db("doctorsPortal").collection("users");
    const doctorsCollection = client.db("doctorsPortal").collection("doctors");

    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);

      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //apointment part here
    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const query = {};
      const options = await appointmentOptionCollection.find(query).toArray();
      const bookingQuery = { appointmentDate: date }; //created a search query named bookingQuery, with the help of which we are going to search in the bookings database, to find out the bookings created on a particular date (for say in 5 august, 29september, 4 dec)
      const alreadyBooked = await bookingsCollection
        .find(bookingQuery)
        .toArray();
      //then we executed the query in the bookingCollection to get the bookings (name, time) reserved in that particular date

      //now we forEach the array of objects of the available slots database and take only those options which's name matches which the name we found by filtering out the bookings database

      options.forEach((option) => {
        const optionBooked = alreadyBooked.filter(
          (book) => book.treatment === option.name
        );
        //if the names match, then we proceed forward
        //then we only get the reserved + name matching booked slots for that particular date, for example,
        // [
        //   {
        //     _id: new ObjectId("637877d621168e4ec9b1a3be"),
        //     appointmentDate: 'Nov 19, 2022',
        //     treatment: 'Teeth Cleaning',
        //     patient: 'Season',
        //     slot: '08.00 AM - 08.30 AM',
        //   }
        // ]
        // [
        //   {
        //     _id: new ObjectId("637877df21168e4ec9b1a3bf"),
        //     appointmentDate: 'Nov 19, 2022',
        //     treatment: 'Oral Surgery',
        //     patient: 'Season',
        //     slot: '09.30 AM - 10.00 AM',
        //   }
        // ]

        const bookedSlots = optionBooked.map((book) => book.slot);
        //now we map each particular date reserved bookings (optionBooked), and take their time slots only

        const remainingSlots = option.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        //now we match the timeslots, with the appointmentOptions each individual option (its property (slot)) with the bookedSlots we got a step earlier, and to get the remaining slots, we simply use the ! key to get the remaining options
        option.slots = remainingSlots;
        //now we change the option.slots as the remaining slots
      });
      res.send(options);
    });
    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      const query = { email: email };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const booking = await bookingsCollection.findOne(query);
      res.send(booking);
    });

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment,
      };

      const alreadyBooked = await bookingsCollection.find(query).toArray();
      if (alreadyBooked.length) {
        const message = `You already have a booking on ${booking.appointmentDate}`;
        return res.send({ acknowledged: false, message });
      }

      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
          expiresIn: "10h",
        });
        return res.send({ accessToken: token });
      }
      res.status(403).send({ accessToken: "" });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users", async (req, res) => {
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    });

    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === "admin" });
    });

    app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });

    app.get("/appointmentSpecialty", async (req, res) => {
      const query = {};
      const result = await appointmentOptionCollection
        .find(query)
        .project({ name: 1 })
        .toArray();
      res.send(result);
    });

    app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result);
    });

    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const doctors = await doctorsCollection.find(query).toArray();
      res.send(doctors);
    });
    app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    });



    app.post('/create-payment-intent', async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;

      const paymentIntent = await stripe.paymentIntents.create({
          currency: 'usd',
          amount: amount,
          "payment_method_types": [
              "card"
          ]
      });
      res.send({
          clientSecret: paymentIntent.client_secret,
      });
  });

    // app.get('/addPrice', async (req, res) => {
    //     const filter = {}
    //     const options = { upsert: true }
    //     const updatedDoc = {
    //         $set: {
    //             price: 99
    //         }
    //     }
    //     const result = await appointmentOptionCollection.updateMany(filter, updatedDoc, options);
    //     res.send(result);
    // })
  } finally {
  }
}

run().catch((error) => console.log(error));

app.get("/", (req, res) => {
  res.send("Doctors portal server running");
});

app.listen(port, () => {
  console.log(`Doctors portal running on ${port}`);
});

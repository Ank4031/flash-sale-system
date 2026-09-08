import mongoose from 'mongoose'

const productSchema = new mongoose.Schema({
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      default: 0,
    },
},{timestamps: true})

export const product = mongoose.model('Product', productSchema)